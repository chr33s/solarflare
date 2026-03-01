export default function ErrorPage({ error }: { error: Error }) {
  return (
    <s-page heading="Error" inlineSize="small">
      <s-paragraph>{error.message}</s-paragraph>
    </s-page>
  );
}
