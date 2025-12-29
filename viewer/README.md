# Viewer (React + Vite)

Frontend for streaming, rendering, and editing large point clouds via deck.gl.

## Run locally
```bash
npm install
npm run dev
```

## Dataset utilities
```bash
npm run generate:demo-tiles
npm run generate:synth
npm run generate:test5m
npm run generate:test300m
```

Note: `generate:test300m` creates a multi-GB dataset under `viewer/public/datasets/test300m/`.

## Tests & build
```bash
npm run lint
npm run test
npm run build
```

## Notes
- Demo datasets live under `viewer/public/datasets/`.
- PCT2 tiles use int32 positions with origin/scale for high-precision UTM-safe decoding.
