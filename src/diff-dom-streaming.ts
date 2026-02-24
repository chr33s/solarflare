// src: https://github.com/brisa-build/diff-dom-streaming/blob/main/src/index.ts

type Walker = {
  root: Node | null;
  [FIRST_CHILD]: (node: Node) => Promise<Node | null>;
  [NEXT_SIBLING]: (node: Node) => Promise<Node | null>;
  [APPLY_TRANSITION]: (v: () => void) => void;
  [FLUSH_SYNC]: () => void;
};

type NextNodeCallback = (node: Node) => void;

type Options = {
  onNextNode?: NextNodeCallback;
  transition?: boolean;
  shouldIgnoreNode?: (node: Node | null) => boolean;
  /** Called after each stream chunk is processed - use to flush pending mutations. */
  onChunkProcessed?: () => void;
  /** Apply mutations synchronously instead of batching via requestAnimationFrame. */
  syncMutations?: boolean;
};

const ELEMENT_TYPE = 1;
const DOCUMENT_TYPE = 9;
const DOCUMENT_FRAGMENT_TYPE = 11;
const APPLY_TRANSITION = 0;
const FIRST_CHILD = 1;
const NEXT_SIBLING = 2;
const FLUSH_SYNC = 3;
const SPECIAL_TAGS = new Set(["HTML", "HEAD", "BODY"]);
const wait = () => new Promise((resolve) => requestAnimationFrame(resolve));

export default async function diff(oldNode: Node, stream: ReadableStream, options?: Options) {
  const walker = await htmlStreamWalker(stream, options);
  const newNode = walker.root!;

  if (oldNode.nodeType === DOCUMENT_TYPE) {
    oldNode = (oldNode as Document).documentElement;
  }

  if (newNode.nodeType === DOCUMENT_FRAGMENT_TYPE) {
    await setChildNodes(oldNode, newNode, walker);
  } else {
    await updateNode(oldNode, newNode, walker);
  }

  // Flush any remaining batched mutations before returning.
  // Without this, mutations scheduled via requestAnimationFrame may not
  // be applied before the caller continues, causing blank pages.
  walker[FLUSH_SYNC]();
}

/**
 * Updates a specific htmlNode and does whatever it takes to convert it to another one.
 */
async function updateNode(oldNode: Node, newNode: Node, walker: Walker) {
  if (oldNode.nodeType !== newNode.nodeType) {
    return walker[APPLY_TRANSITION](() => {
      // oldNode may have been moved/removed by a previous batched mutation
      if (oldNode.parentNode) {
        oldNode.parentNode.replaceChild(newNode.cloneNode(true), oldNode);
      }
    });
  }

  if (oldNode.nodeType === ELEMENT_TYPE) {
    // Treat DSD custom elements as atomic: the old DOM has a real shadow root
    // while the new HTML has a <template shadowrootmode> child — these can't
    // be diffed structurally, so replace the entire element.
    if (hasShadowRoot(oldNode as Element) && hasDsdTemplate(newNode as Element)) {
      return walker[APPLY_TRANSITION](() => {
        if (oldNode.parentNode) {
          oldNode.parentNode.replaceChild(newNode.cloneNode(true), oldNode);
        }
      });
    }

    await setChildNodes(oldNode, newNode, walker);

    walker[APPLY_TRANSITION](() => {
      if (oldNode.nodeName === newNode.nodeName) {
        if (newNode.nodeName !== "BODY") {
          setAttributes((oldNode as Element).attributes, (newNode as Element).attributes);
        }
      } else {
        const hasDocumentFragmentInside = newNode.nodeName === "TEMPLATE";
        const clonedNewNode = newNode.cloneNode(hasDocumentFragmentInside);
        while (oldNode.firstChild) clonedNewNode.appendChild(oldNode.firstChild);
        // oldNode may have been moved/removed by a previous batched mutation
        if (oldNode.parentNode) {
          oldNode.parentNode.replaceChild(clonedNewNode, oldNode);
        }
      }
    });
  } else if (oldNode.nodeValue !== newNode.nodeValue) {
    walker[APPLY_TRANSITION](() => (oldNode.nodeValue = newNode.nodeValue));
  }
}

/** Checks if an element has a live shadow root (from DSD or imperative). */
function hasShadowRoot(el: Element) {
  return !!(el as HTMLElement).shadowRoot;
}

/** Checks if an element contains a `<template shadowrootmode>` child. */
function hasDsdTemplate(el: Element) {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.nodeName === "TEMPLATE" && c.hasAttribute("shadowrootmode")) return true;
  }
  return false;
}

/**
 * Utility that will update one list of attributes to match another.
 */
function setAttributes(oldAttributes: NamedNodeMap, newAttributes: NamedNodeMap) {
  let i, oldAttribute, newAttribute, namespace, name;

  // Remove old attributes.
  for (i = oldAttributes.length; i--; ) {
    oldAttribute = oldAttributes[i];
    namespace = oldAttribute.namespaceURI;
    name = oldAttribute.localName;
    newAttribute = newAttributes.getNamedItemNS(namespace, name);

    if (!newAttribute) oldAttributes.removeNamedItemNS(namespace, name);
  }

  // Set new attributes.
  for (i = newAttributes.length; i--; ) {
    oldAttribute = newAttributes[i];
    namespace = oldAttribute.namespaceURI;
    name = oldAttribute.localName;
    newAttribute = oldAttributes.getNamedItemNS(namespace, name);

    // Avoid register already registered server action in frameworks like Brisa
    if (oldAttribute.name === "data-action") continue;

    if (!newAttribute) {
      // Add a new attribute.
      newAttributes.removeNamedItemNS(namespace, name);
      oldAttributes.setNamedItemNS(oldAttribute);
    } else if (newAttribute.value !== oldAttribute.value) {
      // Update existing attribute.
      newAttribute.value = oldAttribute.value;
    }
  }
}

/**
 * Utility that will nodes childern to match another nodes children.
 */
async function setChildNodes(oldParent: Node, newParent: Node, walker: Walker) {
  let checkOld;
  let oldKey;
  let newKey;
  let foundNode;
  let keyedNodes: Record<string, Node> | null = null;
  let oldNode = oldParent.firstChild;
  let newNode = await walker[FIRST_CHILD](newParent);
  let extra = 0;
  let pendingFragment: DocumentFragment | null = null;
  let pendingBefore: ChildNode | null = null;

  const createFragment = () =>
    oldParent.ownerDocument?.createDocumentFragment?.() ?? document.createDocumentFragment();

  const flushPendingInsertions = () => {
    if (!pendingFragment) return;
    const fragment = pendingFragment;
    const before = pendingBefore;
    pendingFragment = null;
    pendingBefore = null;
    walker[APPLY_TRANSITION](() => {
      if (before && before.parentNode === oldParent) {
        oldParent.insertBefore(fragment, before);
      } else {
        oldParent.appendChild(fragment);
      }
    });
  };

  const queueInsertion = (node: Node, before: ChildNode | null) => {
    if (!pendingFragment || pendingBefore !== before) {
      flushPendingInsertions();
      pendingFragment = createFragment();
      pendingBefore = before;
    }
    pendingFragment.appendChild(node);
  };

  const shouldInsertImmediately = (node: Node) => {
    if (node.nodeType !== ELEMENT_TYPE) return false;
    const el = node as Element;
    return el.tagName === "SCRIPT";
  };

  // Extract keyed nodes from previous children and keep track of total count.
  while (oldNode) {
    extra++;
    checkOld = oldNode;
    oldKey = getKey(checkOld);
    oldNode = oldNode.nextSibling;

    if (oldKey) {
      if (!keyedNodes) keyedNodes = {};
      keyedNodes[oldKey] = checkOld;
    }
  }

  oldNode = oldParent.firstChild;

  // Loop over new nodes and perform updates.
  while (newNode) {
    let insertedNode;

    if (keyedNodes && (newKey = getKey(newNode)) && (foundNode = keyedNodes[newKey])) {
      flushPendingInsertions();
      delete keyedNodes[newKey];
      if (foundNode !== oldNode) {
        walker[APPLY_TRANSITION](() => {
          // oldNode may have been moved/removed by a previous batched mutation
          if (oldNode && oldNode.parentNode === oldParent) {
            oldParent.insertBefore(foundNode!, oldNode);
          } else {
            oldParent.appendChild(foundNode!);
          }
        });
        // Flush immediately so subsequent iterations see correct DOM order
        walker[FLUSH_SYNC]();
      } else {
        oldNode = oldNode.nextSibling;
      }

      await updateNode(foundNode, newNode, walker);
    } else if (oldNode) {
      checkOld = oldNode;
      oldNode = oldNode.nextSibling;
      if (getKey(checkOld)) {
        insertedNode = newNode.cloneNode(true);
        if (shouldInsertImmediately(insertedNode!)) {
          flushPendingInsertions();
          walker[APPLY_TRANSITION](() => {
            if (checkOld!.parentNode === oldParent) {
              oldParent.insertBefore(insertedNode!, checkOld!);
            } else {
              oldParent.appendChild(insertedNode!);
            }
          });
        } else {
          queueInsertion(
            insertedNode!,
            checkOld!.parentNode === oldParent ? (checkOld as ChildNode) : null,
          );
        }
      } else {
        flushPendingInsertions();
        await updateNode(checkOld, newNode, walker);
      }
    } else {
      insertedNode = newNode.cloneNode(true);
      if (shouldInsertImmediately(insertedNode!)) {
        flushPendingInsertions();
        walker[APPLY_TRANSITION](() => oldParent.appendChild(insertedNode!));
      } else {
        queueInsertion(insertedNode!, null);
      }
    }

    newNode = (await walker[NEXT_SIBLING](newNode)) as ChildNode;

    // If we didn't insert a node this means we are updating an existing one, so we
    // need to decrement the extra counter, so we can skip removing the old node.
    if (!insertedNode) extra--;
  }

  flushPendingInsertions();

  walker[APPLY_TRANSITION](() => {
    // Remove old keyed nodes.
    for (oldKey in keyedNodes) {
      const node = keyedNodes![oldKey]!;
      // Node may have been moved/removed by a previous batched mutation
      if (node.parentNode === oldParent) {
        extra--;
        oldParent.removeChild(node);
      }
    }

    // If we have any remaining unkeyed nodes remove them from the end.
    while (--extra >= 0 && oldParent.lastChild) oldParent.removeChild(oldParent.lastChild);
  });
}

function getKey(node: Node) {
  return (node as Element)?.getAttribute?.("key") || (node as Element).id;
}

/**
 * Utility that will walk a html stream and call a callback for each node.
 */
async function htmlStreamWalker(stream: ReadableStream, options: Options = {}) {
  const doc = document.implementation.createHTMLDocument();

  doc.open();
  const decoderStream = new TextDecoderStream();
  const decoderStreamReader = decoderStream.readable.getReader();
  let streamInProgress = true;

  // Batch mutations when View Transitions unavailable to prevent Preact vdom corruption
  let pendingMutations: (() => void)[] = [];
  let flushScheduled = false;

  function flushMutations() {
    const mutations = pendingMutations;
    pendingMutations = [];
    flushScheduled = false;
    for (const mutation of mutations) {
      mutation();
    }
  }

  function flushMutationsSync() {
    if (pendingMutations.length > 0) {
      flushMutations();
    }
  }

  void stream.pipeTo(decoderStream.writable);
  void processStream();

  async function processStream() {
    try {
      while (true) {
        const { done, value } = await decoderStreamReader.read();
        if (done) {
          streamInProgress = false;
          break;
        }

        doc.write(value);

        // Call chunk callback to allow flushing pending mutations progressively
        options.onChunkProcessed?.();
      }
    } finally {
      doc.close();
    }
  }

  while (!doc.documentElement || isLastNodeOfChunk(doc.documentElement)) {
    await wait();
  }

  function next(field: "firstChild" | "nextSibling") {
    return async (node: Node) => {
      if (!node) return null;

      let nextNode = node[field];

      while (options.shouldIgnoreNode?.(nextNode)) {
        nextNode = nextNode![field];
      }

      if (nextNode) options.onNextNode?.(nextNode);

      const waitChildren = field === "firstChild";

      while (isLastNodeOfChunk(nextNode as Element, waitChildren)) {
        await wait();
      }

      return nextNode;
    };
  }

  function isLastNodeOfChunk(node: Node, waitChildren?: boolean) {
    if (!node || !streamInProgress || node.nextSibling) {
      return false;
    }

    if (SPECIAL_TAGS.has(node.nodeName)) {
      return !doc.body?.hasChildNodes?.();
    }

    let parent = node.parentElement;

    while (parent) {
      if (parent.nextSibling) return false;
      parent = parent.parentElement;
    }

    // Related issues to this ternary (hard to reproduce in a test):
    // https://github.com/brisa-build/diff-dom-streaming/pull/15
    // https://github.com/brisa-build/brisa/issues/739
    return waitChildren ? streamInProgress && !node.hasChildNodes?.() : streamInProgress;
  }

  return {
    root: doc.documentElement,
    [FIRST_CHILD]: next("firstChild"),
    [NEXT_SIBLING]: next("nextSibling"),
    [APPLY_TRANSITION]: (v: () => void) => {
      if (options.transition && document.startViewTransition) {
        // Collect all view transitions so the caller can await them all.
        // Previously we only stored the last transition, causing earlier
        // mutations (like body content insertion) to be missed.
        const transition = document.startViewTransition(v);
        const transitions: ViewTransition[] =
          (window as any).lastDiffTransitions ?? ((window as any).lastDiffTransitions = []);
        transitions.push(transition);
        // Keep lastDiffTransition for backwards compatibility
        // @ts-expect-error - expose for router to await
        window.lastDiffTransition = transition;
      } else if (options.syncMutations) {
        // Apply mutations synchronously for progressive streaming of deferred content
        v();
      } else {
        // Batch mutations via requestAnimationFrame to prevent Preact custom element
        // vdom corruption when diff patches inside a mounted element's subtree.
        pendingMutations.push(v);
        if (!flushScheduled) {
          flushScheduled = true;
          requestAnimationFrame(flushMutations);
        }
      }
    },
    [FLUSH_SYNC]: flushMutationsSync,
  };
}
