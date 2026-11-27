/** The hosted viewer's top-right prompt for visitors; "Get started" opens Pascal. */
export function GuestPrompt() {
  return (
    <div className="dark absolute top-4 right-4 z-20 text-foreground">
      <div className="corner-smooth pointer-events-auto flex flex-col items-center gap-4 rounded-2xl border border-border/40 bg-background/95 px-6 py-3 shadow-elevation-3 backdrop-blur-xl transition-colors duration-200 ease-out sm:flex-row">
        <p className="text-center font-medium text-foreground text-sm">
          Want to create your own 3D project?
        </p>
        <a
          className="w-full whitespace-nowrap rounded-full bg-primary px-4 py-2 text-center font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 sm:w-auto"
          href="https://editor.pascal.app"
        >
          Get started
        </a>
      </div>
    </div>
  )
}
