import { Link } from "react-router-dom";
import { Hero } from "../landing/Hero";
import { Features, FinalCta, Footer, HowItWorks, Settlement } from "../landing/Sections";
import { BTN_PRIMARY, FOCUS } from "../landing/styles";

const NAV_LINK = `rounded-button px-3 py-2 font-medium text-mute no-underline hover:text-text ${FOCUS}`;

/** Public marketing page with its own header; rendered outside the sidebar layout. */
export function Landing() {
  return (
    <div className="min-h-screen bg-page text-16 text-text">
      <header className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-6 min-[800px]:px-8">
        <Link to="/" className={`font-display text-28 font-bold text-text no-underline ${FOCUS}`}>
          Predict<span className="text-amber">X</span>
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
          <a href="#how" className={NAV_LINK}>How it works</a>
          <a href="#features" className={NAV_LINK}>Features</a>
          <a href="#settle" className={NAV_LINK}>Settlement</a>
          <Link to="/playground" className={NAV_LINK}>Playground</Link>
          <Link to="/pools" className={`${BTN_PRIMARY} ml-2 !py-2`}>Open dashboard</Link>
        </nav>
      </header>
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <Settlement />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
