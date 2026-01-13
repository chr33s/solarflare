import { useEffect, useState } from "preact/hooks";

export default function Client(props: { SHOPIFY_API_KEY: string }) {
  const [error, setError] = useState<string | null>(null);
  const [shopName, setShopName] = useState<string>("Loading...");
  useEffect(() => {
    void fetch("shopify:admin/api/2026-01/graphql.json", {
      method: "POST",
      body: JSON.stringify({
        query: /* GraphQL */ `
          query GetShop {
            shop {
              name
            }
          }
        `,
        variables: {},
      }),
    })
      .then<any>((res) => res.json())
      .then((res) => {
        setShopName(res.data.shop.name);
      })
      .catch((err) => {
        setShopName("Error");
        setError(err.message ?? "Unknown error");
      });
  });

  return (
    <s-page heading={shopName}>
      <meta name="shopify-api-key" content={props.SHOPIFY_API_KEY} />

      {error && <s-banner heading={error} tone="critical" />}

      <s-section>
        <s-text-field label="Title"></s-text-field>
        <s-text-area label="Description"></s-text-area>
      </s-section>

      <s-section heading="Status" slot="aside">
        <s-select labelAccessibilityVisibility="visible" label="Status">
          <s-option value="active">Active</s-option>
          <s-option value="draft">Draft</s-option>
        </s-select>
      </s-section>
    </s-page>
  );
}
