import Link from "next/link";

const steps = [
  {
    title: "Paste your text",
    body: "Drop in notes, an outline, or a paragraph — anything you want to visualize.",
  },
  {
    title: "Generate",
    body: "AI proposes multiple editable visuals: flowcharts, mind maps, charts, and more.",
  },
  {
    title: "Polish",
    body: "Tweak colors, text, layout, and individual elements on an interactive canvas.",
  },
  {
    title: "Export & share",
    body: "Download as PNG, SVG, PDF, or PPTX, or share a read-only link with your team.",
  },
];

const useCases = [
  {
    icon: "📊",
    title: "Presentations",
    body: "Turn talking points into clean diagrams and drop them straight onto your slides.",
  },
  {
    icon: "✍️",
    title: "Blog posts",
    body: "Explain complex ideas with custom visuals that make long-form writing click.",
  },
  {
    icon: "📱",
    title: "Social media",
    body: "Create scroll-stopping infographics sized for every feed in just a few clicks.",
  },
  {
    icon: "📚",
    title: "Documentation",
    body: "Keep flows, architectures, and processes clear with always-editable diagrams.",
  },
];

// coverage-breadth: mapped-e2e ref=e2e/ui-matrix/auth-public-ui.spec.ts
// Only the unique "Turn text into visuals" hero heading (asserted by "home
// page renders the hero and primary CTAs") is exercised here — the
// how-it-works/use-cases/footer sections below are not asserted by that spec
// and are not covered by this marker.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-ds-surface-sunken">
      <section className="flex w-full flex-col items-center gap-6 px-6 py-20 text-center sm:py-28">
        <span className="rounded-full border border-ds-border-strong px-3 py-1 text-sm font-medium text-ds-text-secondary">
          TextIQ — Text to Visuals
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-ds-text-primary sm:text-5xl lg:text-6xl">
          Turn text into visuals in seconds
        </h1>
        <p className="max-w-xl font-serif text-lg leading-8 text-ds-text-secondary">
          Paste your text and let AI generate editable flowcharts, mind maps,
          infographics, charts, and concept diagrams — then customize, export,
          and collaborate.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="flex h-12 items-center justify-center rounded-full bg-ds-accent px-6 text-base font-medium text-ds-text-on-accent transition hover:opacity-90"
          >
            Get Started Free
          </Link>
          <Link
            href="#how-it-works"
            className="flex h-12 items-center justify-center rounded-full border border-ds-border-strong px-6 text-base font-medium text-ds-text-primary transition hover:bg-ds-surface-sunken"
          >
            See how it works
          </Link>
        </div>

        <div className="mt-10 w-full max-w-4xl">
          <HeroPreview />
        </div>
      </section>

      <section
        id="how-it-works"
        className="w-full scroll-mt-20 border-t border-ds-border-strong bg-ds-surface-base px-6 py-20 sm:py-24"
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-ds-text-primary sm:text-4xl">
            How it works
          </h2>
          <p className="max-w-2xl font-serif text-base leading-7 text-ds-text-secondary">
            From rough notes to a polished visual in four quick steps.
          </p>
        </div>

        <div className="mx-auto mt-12 grid w-full max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="flex flex-col gap-2 rounded-xl border border-ds-border-strong bg-ds-surface-sunken p-5 text-left"
            >
              <span className="text-sm font-semibold text-ds-accent">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-base font-semibold text-ds-text-primary">
                {step.title}
              </h3>
              <p className="text-sm leading-6 text-ds-text-secondary">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="use-cases"
        className="w-full scroll-mt-20 border-t border-ds-border-strong px-6 py-20 sm:py-24"
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-ds-text-primary sm:text-4xl">
            Use cases
          </h2>
          <p className="max-w-2xl font-serif text-base leading-7 text-ds-text-secondary">
            One source text, visuals for everywhere you share ideas.
          </p>
        </div>

        <div className="mx-auto mt-12 grid w-full max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {useCases.map((useCase) => (
            <div
              key={useCase.title}
              className="flex flex-col gap-3 rounded-xl border border-ds-border-strong bg-ds-surface-base p-6 text-left"
            >
              <span
                aria-hidden="true"
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-ds-surface-sunken text-2xl"
              >
                {useCase.icon}
              </span>
              <h3 className="text-base font-semibold text-ds-text-primary">
                {useCase.title}
              </h3>
              <p className="text-sm leading-6 text-ds-text-secondary">
                {useCase.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="w-full border-t border-ds-border-strong bg-ds-surface-base px-6 py-20 sm:py-24">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-ds-text-primary sm:text-4xl">
            Ready to visualize your ideas?
          </h2>
          <p className="max-w-xl font-serif text-base leading-7 text-ds-text-secondary">
            Sign up free and turn your first block of text into a visual in
            under a minute.
          </p>
          <Link
            href="/signup"
            className="flex h-12 items-center justify-center rounded-full bg-ds-accent px-6 text-base font-medium text-ds-text-on-accent transition hover:opacity-90"
          >
            Get Started Free
          </Link>
        </div>
      </section>

      <footer className="w-full border-t border-ds-border-strong px-6 py-8 text-center text-sm text-ds-text-secondary">
        © {new Date().getFullYear()} TextIQ. Turn text into visuals.
      </footer>
    </main>
  );
}

function HeroPreview() {
  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-ds-border-strong bg-ds-surface-base p-4 shadow-sm sm:grid-cols-2 sm:p-6">
      <div className="flex flex-col gap-3 rounded-xl bg-ds-surface-sunken p-5 text-left">
        <span className="text-xs font-semibold tracking-wide text-ds-text-secondary uppercase">
          Your text
        </span>
        <div className="space-y-2">
          <div className="h-3 w-5/6 rounded bg-ds-border-strong" />
          <div className="h-3 w-full rounded bg-ds-border-strong" />
          <div className="h-3 w-2/3 rounded bg-ds-border-strong" />
          <div className="h-3 w-3/4 rounded bg-ds-border-strong" />
          <div className="h-3 w-1/2 rounded bg-ds-border-strong" />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-ds-surface-sunken p-5 text-left">
        <span className="text-xs font-semibold tracking-wide text-ds-text-secondary uppercase">
          Your visual
        </span>
        <svg
          viewBox="0 0 240 150"
          role="img"
          aria-label="Example flowchart generated from text"
          className="h-full w-full"
        >
          <rect
            x="86"
            y="10"
            width="68"
            height="30"
            rx="8"
            fill="var(--ds-accent)"
          />
          <rect
            x="20"
            y="80"
            width="68"
            height="30"
            rx="8"
            fill="var(--ds-border-strong)"
          />
          <rect
            x="152"
            y="80"
            width="68"
            height="30"
            rx="8"
            fill="var(--ds-border-strong)"
          />
          <path
            d="M120 40 L120 60 L54 60 L54 80"
            stroke="var(--ds-text-secondary)"
            strokeWidth="2"
            fill="none"
          />
          <path
            d="M120 40 L120 60 L186 60 L186 80"
            stroke="var(--ds-text-secondary)"
            strokeWidth="2"
            fill="none"
          />
        </svg>
      </div>
    </div>
  );
}
