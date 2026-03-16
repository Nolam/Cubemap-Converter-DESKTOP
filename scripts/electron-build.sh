#!/bin/bash
npm run build && npx electron-builder --config electron-builder.yml "$@"
