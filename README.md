# Will It Fit?

A fast single-page floor-plan fitting tool for renters, buyers, brokers, and people moving into tight apartments.

Upload a floor plan. Add your furniture. Know what fits.

## Features

- Upload PNG, JPG, or first-page PDF floor plans
- Locked floor-plan canvas with zoom and pan
- Scale calibration from a drawn known-distance line
- Real-size furniture library with common apartment pieces
- Custom furniture by name, width, and depth
- Move, rotate, duplicate, delete, and resize placed furniture
- Labels and dimensions on every furniture object
- Simple overlap warning for furniture collisions
- LocalStorage layout persistence
- Export final layout as PNG, PDF, or JSON

## Tech

- Next.js App Router
- React
- Tailwind CSS
- React Konva / Konva
- PDF.js for PDF import
- jsPDF for PDF export

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production Build

```bash
npm run lint
npm run build
```
