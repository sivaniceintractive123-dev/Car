# SCUDERIA CLASSICHE - 1962 V12 Grand Tourer Unveiling

An ultra-luxury cinematic 3D scroll-driven automotive web experience showcasing the legendary 1962 Colombo V12 Berlinetta (Chassis No. 0384 GT).

## ✨ Features

- **153-Frame 1080p Canvas Scroll Animation**: Smooth hardware-accelerated canvas scrubbing synchronized with scroll velocity.
- **Smart Milestone Preloading**: Decodes milestone frames first for instant interactive response.
- **4-Stage Storytelling HUD**: Dynamic editorial phase cards (The Veil, The Awakening, Colombo V12 Heart, The Masterpiece Revealed).
- **Interactive 3D Hotspot Beacons**: Inspect engine, wheels, coachwork, and atelier cockpit specs with detailed modals.
- **Real-Time V12 Audio Engine Synthesizer**: Authentic multi-oscillator Web Audio API engine sound with working Veglia Borletti tachometer (0-8000 RPM) and throttle rev controls.
- **Archival Color Atelier**: Interactive palette swatches (*Rosso Corsa*, *Grigio Argento*, *Blu Tour de France*, *Verde British*, *Nero Stellato*).
- **Video Glimpse Cinema Modal**: Integrated 60 FPS motion capture reel.
- **Full Responsive Design**: Fluid mobile drawer navigation, touch controls, and high-DPI retina display scaling.

## 📁 Project Structure

```text
Car/
├── index.html            # Main web page
├── css/
│   └── styles.css        # Luxury dark aesthetic & animations
├── js/
│   └── script.js         # Canvas engine, audio synth & interactions
├── images/
│   ├── 00001.png ...     # 153 scroll animation frames
│   ├── car_glimpse.mp4   # Cinema video glimpse
│   └── car_hero.jpg      # Masterpiece poster image
├── server.js             # Node.js static streaming server
└── start.bat             # 1-click launcher
```

## 🚀 Getting Started

Double-click `start.bat` or run:

```bash
node server.js
```

Open `http://localhost:5500` in your web browser.
