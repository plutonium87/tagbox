# Chrome rendering regression fixture

Run `npm run dev` and open `/tests/chrome-rendering.html`. The fixture creates three independent renderer instances for silver, copper and gold, each with 50 px dabs at 100% reflection intensity. Every panel contains a wide horizontal stroke crossed by a vertical and diagonal stroke. The page also reports actual decoded sRGB bytes from representative PNG pixels.

Check that curved environment light strips move across the tube as its normal changes, with soft dark-to-bright transitions and visible material hue. Both crossings should share one continuous surface, without a thin vertical seam or streak beneath the stroke.

For custom surface mask and compositing checks, run `npm run dev` and open `/tests/surface-compositing.html`. The fixture compares each registered surface's Navigator preview against its static artwork, checks Model H's background and freight base, underlay mask coverage, Steel Doors foreground-above-paint ordering, independent paint erasing, main editor stack, and existing Delivery Truck and Steel Doors mask checks.

For runoff blending and mask coverage checks, run `npm run dev` and open `/tests/runoff-compositing.html`. The fixture renders the runoff fragment shader against a framebuffer with full and partial mask coverage and AO on and off.

For keyboard shortcut checks, run `npm run dev` and open `/tests/keyboard-shortcuts.html`. The fixture exercises B/M/E/F, tool-setting retention, editable-control guards, fullscreen state synchronization and existing keyboard shortcuts.
