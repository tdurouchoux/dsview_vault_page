import { pathToRoot, joinSegments } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

const Header: QuartzComponent = ({ children, cfg, fileData }: QuartzComponentProps) => {
  const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
  const baseDir = fileData.slug === "404" ? url.pathname : pathToRoot(fileData.slug!)
  const logoPath = joinSegments(baseDir, "static/dsview-icon.png")

  return (
    <header>
      <img src={logoPath} alt={cfg.pageTitle} class="header-logo" />
      {children}
    </header>
  )
}

Header.css = `
header {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin: 2rem 0;
  gap: 1.5rem;
}

header h1 {
  margin: 0;
  flex: auto;
}

header .header-logo {
  height: 2.5rem;
  width: auto;
  flex-shrink: 0;
}
`

export default (() => Header) satisfies QuartzComponentConstructor
