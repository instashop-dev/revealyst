// Numbered, spec-doc-style section chrome for the landing page.
export function Section({
  id,
  index,
  eyebrow,
  title,
  lead,
  children,
}: {
  id?: string;
  index: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-20 md:py-24">
        <div className="flex max-w-2xl flex-col gap-3">
          <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            {index} — {eyebrow}
          </span>
          <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance">
            {title}
          </h2>
          {lead ? (
            <p className="text-base text-muted-foreground text-pretty">
              {lead}
            </p>
          ) : null}
        </div>
        {children}
      </div>
    </section>
  );
}
