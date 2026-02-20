const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const sizes = [180, 192]; // 180: Apple touch icon, 192: PWA
const svgPath = path.join(__dirname, "..", "favicon.svg");
const svg = fs.readFileSync(svgPath);

async function build() {
  for (const size of sizes) {
    const outPath = path.join(__dirname, "..", size === 180 ? "apple-touch-icon.png" : "icon-192.png");
    await sharp(svg).resize(size, size).png().toFile(outPath);
    console.log("Created:", outPath);
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
