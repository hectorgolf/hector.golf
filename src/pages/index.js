import * as React from "react"

// styles
const pageStyles = {
  color: "#232129",
  padding: 96,
  fontFamily: "-apple-system, Roboto, sans-serif, serif",
}
const headingStyles = {
  marginTop: 0,
  marginBottom: 64,
  maxWidth: 320,
}
const headingAccentStyles = {
  color: "#663399",
}

const covers = [
  { src: "../images/GolfPeppis-2021-Finnkampen-Special-Edition.png", alt: "Golf Peppis - 2021 Finnkampen Special Edition" },
  { src: "../images/GolfReport-2021-09-16.png", alt: "Golf Report - Syyskuu 16, 2021" },
  { src: "../images/GolfReport-2021-09-14.png", alt: "Golf Report - Syyskuu 14, 2021" },
  { src: "../images/GolfReport-2021-09-07.png", alt: "Golf Report - Syyskuu 7, 2021" },
  { src: "../images/GolfReport-2021-08-30J.png", alt: "Golf Report - Elokuu 30, 2021 Juhlanumero" },
  { src: "../images/GolfReport-2021-08-30.png", alt: "Golf Report - Elokuu 30, 2021" },
  { src: "../images/GolfReport-2021-08-27.png", alt: "Golf Report - Elokuu 27, 2021" },
  { src: "../images/GolfReport-2021-08-15B.png", alt: "Golf Report - Elokuu 15, 2021 B" },
  { src: "../images/GolfReport-2021-08-15A.png", alt: "Golf Report - Elokuu 15, 2021 A" },
  { src: "../images/GolfReport-2021-08-09.png", alt: "Golf Report - Elokuu 9, 2021" },
]

const IndexPage = () => {
  return (
    <main style={pageStyles}>
      <title>Golf Report - Past issues</title>
      <h1 style={headingStyles}>
        Golf Report<br /><span style={headingAccentStyles}>past issues</span>
      </h1>
      {covers.map(cover => (<img src={cover.src} alt={cover.alt}/>))}
    </main>
  )
}

export default IndexPage
