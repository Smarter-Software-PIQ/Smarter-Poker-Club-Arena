# Smooth Face Card Artwork At Its Display Resolution

The retained decoded canvas added for immediate card reveals was drawn at the source image's full resolution. CSS downscaling that canvas aliases the fine lines in queens, kings and jacks, visibly distorting their faces even though the original artwork remains intact.

The canvas now filters the decoded image at the card's displayed device resolution with high-quality smoothing. A resize observer refreshes that resolution after table visibility and layout changes. Immediate reveal pixels, both color decks, image accessibility and failure fallbacks remain intact. Focused coverage pins device densities and the existing real-component first-paint/remount regression checks the actual rendered resolution.
