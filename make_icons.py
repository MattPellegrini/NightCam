import cairosvg

# Render PNGs at required sizes
cairosvg.svg2png(url='nightcam-icon.svg', write_to='static/icons/apple-touch-icon.png', output_width=180, output_height=180)
cairosvg.svg2png(url='nightcam-icon.svg', write_to='static/icons/icon-192.png', output_width=192, output_height=192)
cairosvg.svg2png(url='nightcam-icon.svg', write_to='static/icons/icon-512.png', output_width=512, output_height=512)

print("All app icons successfully generated in static/icons/")
