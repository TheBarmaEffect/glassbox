# A Glass Box Around the Black Box, LaTeX source

## Files
- `main.tex`, full paper, self-contained two-column US Letter preamble
- `references.bib`, 23 entries, every one verified against arXiv/DBLP/publisher on 2026-08-11
- `main.pdf`, compiled output (9 pages incl. references)

## Build
```
latexmk -pdf main.tex && bibtex main && latexmk -pdf main.tex
```
Requires: pgf/tikz, caption, booktabs, multirow, microtype, enumitem, courier.

## Overleaf
Upload `glassbox-paper-overleaf.zip` via New Project > Upload Project.
Set the compiler to pdfLaTeX and the main document to `main.tex`.

## Retargeting a venue
The preamble is self-contained so it compiles anywhere. To switch to an AAAI kit,
drop in the style files, replace everything above `\begin{document}`, and keep the
body unchanged. Note the two tables use `table*` (full width) and will need
`\twocolumn`-compatible float handling in some kits.

## Page budget
9 pages total. The bibliography occupies roughly the last 1.2 pages, so technical
content is about 7.8 pages: within an 8-page-excluding-references limit.
