/**
 * Themed wording on screen, plain wording for assistive technology. Screen-reader output
 * must never depend on the visual theme (docs/02-prd.md §5 Accessibility), so the metaphor
 * never carries meaning. Inside a control this is also what keeps the accessible name plain:
 * the themed span is hidden from the name computation, the plain one is not.
 */
export function Themed({ visible, plain }: { visible: string; plain: string }) {
  if (visible === plain) return <>{visible}</>;
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{plain}</span>
    </>
  );
}
