# convert images to webp
find . -type f -regex ".*\.\(jpg\|jpeg\|png\)" -exec mogrify -format webp {}  \; -print
find . -type f -regex ".*\.\(jpg\|jpeg\|png\)" -exec rm {}  \; -print

# resize to 1024 pixels wide
find . -maxdepth 1 -type f -regex ".*\.\(webp\)" -exec convert {} -resize 1024x {}  \; -print

# make small versions for the post listing
find . -maxdepth 1 -type f -regex ".*\.\(webp\)" -exec bash -c 'convert "$0" -resize 200x "${0%.*}-small.${0##*.}"' {} \; -print
