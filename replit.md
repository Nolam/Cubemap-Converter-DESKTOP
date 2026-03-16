# CubeMap to HDRI Converter

## Overview
A desktop application (Electron) that converts cubemap format images into equirectangular HDRI files (.hdr, .exr, 16-bit .png, 32-bit .tiff, .jpg, .dds). Supports both single DDS files containing all 6 cubemap faces and 6 individual face files (DDS, PNG, JPG, TGA, TIFF). Also runs as a web app for development.

## Project Architecture

### Electron (electron/)
- **main.mjs** - Electron main process: starts Express server on a random port, opens BrowserWindow
- **electron-builder.yml** - Build config for Windows NSIS installer and macOS DMG

### Frontend (client/src/)
- **pages/home.tsx** - Main converter page with upload, preview, and conversion UI
- **components/file-upload-zone.tsx** - Drag & drop file upload supporting single/individual modes
- **components/cubemap-preview.tsx** - Visual preview of uploaded cubemap faces
- **components/conversion-panel.tsx** - Output format/resolution settings and download
- **components/axis-settings.tsx** - Coordinate system preset selector and custom axis remapping UI
- **components/welcome-popup.tsx** - Thank-you popup (free for any use) with PayPal donation link

### Backend (server/)
- **routes.ts** - API endpoints for upload, preview, convert, download — no rate limits, inline conversion with SSE progress
- **dds-parser.ts** - DDS file binary parser supporting multiple HDR pixel formats (RGBA32F, RGBA16F, BC6H, etc.)
- **image-decoder.ts** - Standard image format decoder (PNG, JPG, TGA, TIFF) using sharp + custom TGA parser
- **cubemap-converter.ts** - Cubemap to equirectangular projection with bilinear interpolation and granular progress callbacks
- **hdr-encoder.ts** - Radiance HDR (RGBE) format encoder with RLE compression and progress callbacks
- **exr-encoder.ts** - OpenEXR format encoder with half-float precision and progress callbacks
- **png-encoder.ts** - 16-bit PNG encoder using manual PNG construction (zlib) with progress callbacks
- **jpeg-encoder.ts** - JPEG encoder using sharp with Reinhard tone mapping and progress callbacks
- **tiff-encoder.ts** - TIFF 32-bit float encoder (single-strip, IEEE 754) with progress callbacks
- **dds-encoder.ts** - DDS RGBA16F (DX10) encoder with progress callbacks

### Shared (shared/)
- **schema.ts** - TypeScript types, Zod schemas, cubemap face definitions, coordinate system presets and axis mapping types

### CI/CD (.github/workflows/)
- **build.yml** - GitHub Actions workflow: builds Windows .exe (NSIS) and macOS .dmg on tag push

## Key Technical Details
- **No rate limits or usage caps** — completely free for any use including commercial
- **No worker threads** — conversion runs inline on the main thread with progress callbacks
- **ProgressCallback type** exported from cubemap-converter.ts, used by all encoders
- Progress ranges: projection 8–90%, encoding 91–96%, file write 97%
- Sessions are stored in memory with 15-minute TTL, with explicit DELETE /api/session/:id cleanup
- File uploads use multer with 512MB limit, XHR with real progress tracking
- Upload flow: XHR progress % → "Server processing..." transition at 100% → animated step-by-step results
- Supports DX10 extended header DDS files
- DDS parser safety: max 8192px face dimensions, max 16 mip levels, buffer truncation detection
- Cubemap faces: +X, -X, +Y, -Y, +Z, -Z
- Bilinear interpolation for equirectangular sampling
- XHR abort on component unmount and page close (beforeunload)
- No database required (stateless conversion tool)
- Welcome popup on first visit (localStorage-dismissed) with PayPal donation link (David Parrella)
- Electron main process finds a free port, starts Express, then opens BrowserWindow to localhost

## Recent Changes
- Packaged as Electron desktop app with electron-builder (Windows NSIS .exe, macOS .dmg) (Mar 2026)
- Added GitHub Actions workflow for automated builds on tag push (Mar 2026)
- Removed all rate limiting, IP tracking, usage caps, and daily conversion limits (Mar 2026)
- Removed worker threads — conversion runs inline with onProgress callbacks (Mar 2026)
- Expanded progress reporting: buffer allocation, face corrections, axis transform, row-level projection, format-specific encoder stages (Mar 2026)
- Welcome popup rewritten as free-use thank-you with PayPal donation link (Mar 2026)
- Removed conversion-worker.mjs (Mar 2026)

## User Preferences
- None specified yet
