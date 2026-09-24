# Vendored browser libraries

Copied from the npm packages below (dist builds). The only change is the removed
`sourceMappingURL` comment line: the `.map` files are not shipped, so the browser would ask for
them and get a 404. Update by replacing the files with a newer release of the same package and
removing that line again.

| Folder | Package | Version | License |
|---|---|---|---|
| bootstrap | bootstrap | 5.3.8 | MIT |
| bootstrap-icons | bootstrap-icons | 1.13.1 | MIT |
| jquery | jquery | 4.0.0 | MIT |
| chartjs | chart.js | 4.5.1 | MIT |
| showdown | showdown | 2.1.0 | MIT |
| dompurify | dompurify | 3.4.16 | Apache-2.0 or MPL-2.0 |
| qrcode | qrcode-generator | 2.0.4 | MIT |
