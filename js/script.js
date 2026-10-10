/**
 * SCUDERIA CLASSICHE - 1962 V12 BERLINETTA
 * Ultra-Luxury Interactive Scroll & Audio Engine
 */

(function () {
  'use strict';

  // ==========================================================================
  // CONFIGURATION & CONSTANTS
  // ==========================================================================
  const TOTAL_FRAMES = 153;
  const FRAME_DIR = 'images/';
  const FALLBACK_DIR = './images/';

  // DOM Elements
  const canvas = document.getElementById('car-canvas');
  const ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
  const revealSection = document.getElementById('reveal-section');
  const preloader = document.getElementById('preloader');
  const loaderProgress = document.getElementById('loader-progress');
  const loaderPercent = document.getElementById('loader-percent');
  const loaderStatus = document.getElementById('loader-status');

  // HUD Elements
  const frameCounter = document.getElementById('frame-counter');
  const phaseTag = document.getElementById('phase-tag');
  const scrubFill = document.getElementById('scrubber-fill');
  const scrubThumb = document.getElementById('scrubber-thumb');
  const scrubTrack = document.getElementById('scrubber-track');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');

  // State Variables
  const images = new Array(TOTAL_FRAMES + 1);
  const loadedIndices = new Set();
  let loadedCount = 0;
  let targetProgress = 0;
  let currentProgress = 0;
  let currentFrameIndex = 1;
  let isPlaying = false;
  let playAnimationId = null;
  let isDraggingScrubber = false;
  let touchStartY = 0;
  let touchStartProgress = 0;

  // Audio Synthesizer State
  let audioCtx = null;
  let engineNodes = null;
  let isEngineRunning = false;
  let targetRPM = 850;
  let currentRPM = 850;
  let rpmInterval = null;

  // ==========================================================================
  // 1. IMAGE PRELOADER WITH SMART PRIORITIZATION & FALLBACK
  // ==========================================================================
  function padZero(num, size = 5) {
    let s = num + '';
    while (s.length < size) s = '0' + s;
    return s;
  }

  function getFrameSrc(index, useFallback = false) {
    const filename = padZero(index) + '.png';
    return (useFallback ? './images/' : 'images/') + filename;
  }

  function dismissPreloader() {
    if (preloader && !preloader.classList.contains('loaded')) {
      preloader.classList.add('loaded');
    }
  }

  function loadImage(index, onComplete) {
    if (images[index]) {
      if (onComplete) onComplete(images[index]);
      return;
    }

    const img = new Image();
    // Do NOT set crossOrigin - causes CORS blocking on file:/// protocol!

    img.onload = () => {
      images[index] = img;
      loadedIndices.add(index);
      loadedCount++;
      updatePreloaderProgress();

      // Render frame 1 immediately once it's available!
      if (index === 1) {
        renderFrame(1);
      }
      if (onComplete) onComplete(img);
    };

    img.onerror = () => {
      // Try relative fallback
      const fallbackImg = new Image();
      fallbackImg.onload = () => {
        images[index] = fallbackImg;
        loadedIndices.add(index);
        loadedCount++;
        updatePreloaderProgress();
        if (index === 1) {
          renderFrame(1);
        }
        if (onComplete) onComplete(fallbackImg);
      };
      fallbackImg.onerror = () => {
        if (onComplete) onComplete(null);
      };
      fallbackImg.src = getFrameSrc(index, true);
    };

    img.src = getFrameSrc(index, false);
  }

  function updatePreloaderProgress() {
    const percent = Math.min(100, Math.round((loadedCount / TOTAL_FRAMES) * 100));
    if (loaderProgress) loaderProgress.style.width = `${Math.max(percent, 8)}%`;
    if (loaderPercent) loaderPercent.textContent = `${percent}%`;
    if (loaderStatus) {
      if (percent < 30) loaderStatus.textContent = `UNVEILING CHASSIS BUFFERS... (${loadedCount}/${TOTAL_FRAMES})`;
      else if (percent < 75) loaderStatus.textContent = `DECODING 1962 V12 FRAMES... (${loadedCount}/${TOTAL_FRAMES})`;
      else if (percent < 100) loaderStatus.textContent = `SYNCHRONIZING CINEMATIC TIMELINE... (${loadedCount}/${TOTAL_FRAMES})`;
      else loaderStatus.textContent = `READY FOR UNVEILING`;
    }

    // Dismiss preloader as soon as frame 1 and a few buffer frames are loaded (or >= 8%)
    if ((loadedIndices.has(1) && loadedCount >= 3) || percent >= 10) {
      dismissPreloader();
    }
  }

  function startSmartPreload() {
    // Safety auto-dismiss preloader after 1.5 seconds so user is NEVER blocked
    setTimeout(dismissPreloader, 1500);

    // Prioritize frame 1 first for instant reveal
    loadImage(1, () => {
      renderFrame(1);
      dismissPreloader();
    });

    // Milestone frames
    const milestones = [2, 10, 25, 45, 65, 85, 105, 125, 140, 153];
    milestones.forEach(m => loadImage(m));

    // Background load remaining frames with concurrent pool
    setTimeout(() => {
      loadRemainingFrames();
    }, 150);
  }

  function loadRemainingFrames() {
    // Load remaining frames with concurrent pool
    const pendingIndices = [];
    for (let i = 1; i <= TOTAL_FRAMES; i++) {
      if (!loadedIndices.has(i)) {
        pendingIndices.push(i);
      }
    }

    const CONCURRENCY = 6;
    let active = 0;
    let queueIdx = 0;

    function next() {
      if (queueIdx >= pendingIndices.length) return;
      while (active < CONCURRENCY && queueIdx < pendingIndices.length) {
        const frameToLoad = pendingIndices[queueIdx++];
        active++;
        loadImage(frameToLoad, () => {
          active--;
          next();
        });
      }
    }

    next();
  }

  // Find nearest loaded frame index to prevent black screens while scrubbing quickly
  function getNearestLoadedFrame(targetIdx) {
    if (loadedIndices.has(targetIdx)) return targetIdx;
    if (loadedIndices.size === 0) return null;

    let nearest = 1;
    let minDiff = Infinity;
    for (const idx of loadedIndices) {
      const diff = Math.abs(idx - targetIdx);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = idx;
      }
    }
    return nearest;
  }

  // ==========================================================================
  // 2. HIGH-PERFORMANCE CANVAS RENDERER
  // ==========================================================================
  let canvasWidth = 0;
  let canvasHeight = 0;

  function resizeCanvas() {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for optimal 60fps performance
    const displayWidth = window.innerWidth;
    const displayHeight = window.innerHeight;

    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    canvasWidth = canvas.width;
    canvasHeight = canvas.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderFrame(currentFrameIndex);
  }

  window.addEventListener('resize', resizeCanvas, { passive: true });

  function renderFrame(index) {
    if (!canvas || !ctx) return;

    const availableIdx = getNearestLoadedFrame(index);
    if (!availableIdx || !images[availableIdx]) return;

    const img = images[availableIdx];
    const displayWidth = window.innerWidth;
    const displayHeight = window.innerHeight;

    // Object-fit: cover math
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const screenRatio = displayWidth / displayHeight;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (screenRatio > imgRatio) {
      drawWidth = displayWidth;
      drawHeight = displayWidth / imgRatio;
      offsetX = 0;
      offsetY = (displayHeight - drawHeight) / 2;
    } else {
      drawHeight = displayHeight;
      drawWidth = displayHeight * imgRatio;
      offsetX = (displayWidth - drawWidth) / 2;
      offsetY = 0;
    }

    ctx.clearRect(0, 0, displayWidth, displayHeight);
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    // Apply color tint if atelier color selected
    const activeColor = document.documentElement.getAttribute('data-car-tint');
    if (activeColor && activeColor !== 'default') {
      ctx.save();
      ctx.globalCompositeOperation = 'color';
      ctx.fillStyle = activeColor;
      ctx.globalAlpha = 0.22;
      ctx.fillRect(0, 0, displayWidth, displayHeight);
      ctx.restore();
    }
  }

  // ==========================================================================
  // 3. SCROLL SYNCHRONIZER & LERP ENGINE
  // ==========================================================================
  function updateScrollProgress() {
    if (!revealSection) return;

    const rect = revealSection.getBoundingClientRect();
    const totalScrollable = rect.height - window.innerHeight;

    if (totalScrollable <= 0) return;

    // Calculate normalized progress within the reveal section [0, 1]
    const scrolled = -rect.top;
    const progress = Math.max(0, Math.min(1, scrolled / totalScrollable));

    if (!isPlaying && !isDraggingScrubber) {
      targetProgress = progress;
    }
  }

  window.addEventListener('scroll', updateScrollProgress, { passive: true });

  // Animation Loop (Lerping for fluid 60-120fps motion)
  function renderLoop() {
    // Smooth progress interpolation
    const ease = 0.12;
    currentProgress += (targetProgress - currentProgress) * ease;

    if (Math.abs(targetProgress - currentProgress) < 0.0005) {
      currentProgress = targetProgress;
    }

    const calculatedFrame = Math.max(1, Math.min(TOTAL_FRAMES, Math.floor(currentProgress * (TOTAL_FRAMES - 1)) + 1));

    if (calculatedFrame !== currentFrameIndex) {
      currentFrameIndex = calculatedFrame;
      renderFrame(currentFrameIndex);
      updateHUD(currentFrameIndex, currentProgress);
    }

    requestAnimationFrame(renderLoop);
  }

  // ==========================================================================
  // 4. STORYTELLING HUD & TELEMETRY UPDATES
  // ==========================================================================
  function updateHUD(frame, progress) {
    // Update frame counter
    if (frameCounter) {
      frameCounter.textContent = `FRAME ${padZero(frame, 3)} / ${TOTAL_FRAMES}`;
    }

    // Update scrubber UI
    const pct = (progress * 100).toFixed(1);
    if (scrubFill) scrubFill.style.width = `${pct}%`;
    if (scrubThumb) scrubThumb.style.left = `${pct}%`;

    // Stage cards & phase detection
    const card1 = document.getElementById('story-stage-1');
    const card2 = document.getElementById('story-stage-2');
    const card3 = document.getElementById('story-stage-3');
    const card4 = document.getElementById('story-stage-4');

    // Hotspot visibility based on progress
    const hotspotsContainer = document.getElementById('canvas-hotspots');
    if (hotspotsContainer) {
      // Hotspots emerge as the veil is pulled back (frame > 50)
      hotspotsContainer.style.opacity = frame > 50 ? '1' : '0';
      hotspotsContainer.style.pointerEvents = frame > 50 ? 'auto' : 'none';
    }

    // Phase tagging & card transitions
    if (frame <= 35) {
      if (phaseTag) phaseTag.textContent = 'ACT I // THE VEIL';
      setActiveStoryCard(card1, [card2, card3, card4]);
    } else if (frame <= 80) {
      if (phaseTag) phaseTag.textContent = 'ACT II // THE AWAKENING';
      setActiveStoryCard(card2, [card1, card3, card4]);
    } else if (frame <= 125) {
      if (phaseTag) phaseTag.textContent = 'ACT III // COLOMBO V12 HEART';
      setActiveStoryCard(card3, [card1, card2, card4]);
    } else {
      if (phaseTag) phaseTag.textContent = 'ACT IV // THE MASTERPIECE REVEALED';
      setActiveStoryCard(card4, [card1, card2, card3]);
    }
  }

  function setActiveStoryCard(activeCard, inactiveCards) {
    if (activeCard && !activeCard.classList.contains('active')) {
      activeCard.classList.add('active');
    }
    inactiveCards.forEach(c => {
      if (c && c.classList.contains('active')) c.classList.remove('active');
    });
  }

  // ==========================================================================
  // 5. INTERACTIVE SCRUBBER & AUTO-PLAY REEL
  // ==========================================================================
  function setupScrubber() {
    if (!scrubTrack) return;

    function handleScrub(e) {
      const rect = scrubTrack.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      targetProgress = pos;
      currentProgress = pos;

      // Also adjust window scroll position to match
      if (revealSection) {
        const totalScrollable = revealSection.offsetHeight - window.innerHeight;
        const newScrollY = revealSection.offsetTop + (pos * totalScrollable);
        window.scrollTo({ top: newScrollY, behavior: 'instant' });
      }
    }

    scrubTrack.addEventListener('mousedown', (e) => {
      isDraggingScrubber = true;
      pauseCinematic();
      handleScrub(e);
      window.addEventListener('mousemove', handleScrub);
      window.addEventListener('mouseup', () => {
        isDraggingScrubber = false;
        window.removeEventListener('mousemove', handleScrub);
      }, { once: true });
    });

    scrubTrack.addEventListener('touchstart', (e) => {
      isDraggingScrubber = true;
      pauseCinematic();
      handleScrub(e);
      window.addEventListener('touchmove', handleScrub, { passive: true });
      window.addEventListener('touchend', () => {
        isDraggingScrubber = false;
        window.removeEventListener('touchmove', handleScrub);
      }, { once: true });
    }, { passive: true });
  }

  function toggleAutoPlay() {
    if (isPlaying) {
      pauseCinematic();
    } else {
      playCinematic();
    }
  }

  function playCinematic() {
    isPlaying = true;
    if (playIcon) playIcon.classList.add('hidden');
    if (pauseIcon) pauseIcon.classList.remove('hidden');

    let lastTime = performance.now();
    const fps = 28; // cinematic 28 fps
    const frameDuration = 1000 / fps;

    function step(now) {
      if (!isPlaying) return;
      const elapsed = now - lastTime;

      if (elapsed >= frameDuration) {
        lastTime = now;
        targetProgress += 1 / TOTAL_FRAMES;
        if (targetProgress > 1) {
          targetProgress = 0; // loop back
        }

        if (revealSection) {
          const totalScrollable = revealSection.offsetHeight - window.innerHeight;
          const newScrollY = revealSection.offsetTop + (targetProgress * totalScrollable);
          window.scrollTo({ top: newScrollY, behavior: 'instant' });
        }
      }
      playAnimationId = requestAnimationFrame(step);
    }
    playAnimationId = requestAnimationFrame(step);
  }

  function pauseCinematic() {
    isPlaying = false;
    if (playIcon) playIcon.classList.remove('hidden');
    if (pauseIcon) pauseIcon.classList.add('hidden');
    if (playAnimationId) {
      cancelAnimationFrame(playAnimationId);
      playAnimationId = null;
    }
  }

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', toggleAutoPlay);
  }

  // ==========================================================================
  // 6. INTERACTIVE 3D HOTSPOTS MODAL
  // ==========================================================================
  const HOTSPOT_DATA = {
    engine: {
      title: 'Type 168/62 Colombo 60° V12',
      category: 'POWERTRAIN // MARANELLO SCUDERIA',
      specs: [
        { label: 'Displacement', val: '2,953 cc (3.0 Litre)' },
        { label: 'Induction', val: '3x Weber 36 DCL6 Twin-Choke Carburetors' },
        { label: 'Max Output', val: '240 bhp @ 7,500 rpm' },
        { label: 'Torque', val: '265 Nm @ 5,500 rpm' },
        { label: 'Top Speed', val: '150 mph (241 km/h)' }
      ],
      desc: 'Conceived by legendary engineer Gioacchino Colombo. Features an all-aluminum alloy block with wet cast-iron liners, single overhead camshafts per bank, and dry-sump racing lubrication. Renowned worldwide for its razor-sharp throttle acoustics and mechanical reliability.'
    },
    wheels: {
      title: 'Borrani Record RW3801 Wire Wheels',
      category: 'RUNNING GEAR // MILANO',
      specs: [
        { label: 'Diameter', val: '15 x 6.0L Inches' },
        { label: 'Lacing', val: '72 Polished Stainless Steel Spokes' },
        { label: 'Locking', val: 'Three-Ear Polished Chrome Knock-Off Spinners' },
        { label: 'Tires', val: 'Pirelli Cinturato 185VR15 HS' },
        { label: 'Braking', val: 'Dunlop Servo-Assisted Solid Discs' }
      ],
      desc: 'Handcrafted by Ruote Borrani in Milan. The light-alloy rim significantly reduced unsprung mass, paired with authentic center-lock knock-off nuts designed for instant pit stops during endurance races like the 24 Hours of Le Mans.'
    },
    coachwork: {
      title: 'Scaglietti Handcrafted Aluminum Silhouette',
      category: 'CARROZZERIA // MODENA',
      specs: [
        { label: 'Design House', val: 'Pininfarina (Turin)' },
        { label: 'Coachbuilder', val: 'Carrozzeria Scaglietti (Modena)' },
        { label: 'Construction', val: 'Hand-beaten Aluminum Hood & Doors' },
        { label: 'Aerodynamics', val: 'Integrated Kamm-tail Fastback' },
        { label: 'Total Weight', val: '1,020 kg (2,248 lbs)' }
      ],
      desc: 'Sergio Pininfarina considered the 250 GT Berlinetta the purest proportioned silhouette ever conceived. Hand-beaten over wooden bucks by Scaglietti artisans, the design seamlessly bridges high-speed aerodynamic stability with timeless Italian elegance.'
    },
    cockpit: {
      title: 'Veglia Borletti & Nardi Cockpit Atelier',
      category: 'INTERIOR // TORINO LUXURY',
      specs: [
        { label: 'Gauges', val: 'Veglia Borletti Dual Central Instrument Dials' },
        { label: 'Steering', val: 'Nardi 3-Spoke Mahogany & Polished Aluminum' },
        { label: 'Upholstery', val: 'Connolly Vaumol VM 846 Vaumol Tan Leather' },
        { label: 'Shifter', val: 'Open Gated Chrome Shift Lever' },
        { label: 'Luggage', val: 'Quilted Leather Rear Deck with Hold-Down Straps' }
      ],
      desc: 'A true driver-centric cockpit. The iconic large central tachometer and speedometer stand proud beneath anti-reflective cowls, while the delicate tactile feedback of the mahogany-rimmed Nardi wheel connects driver and machine in absolute harmony.'
    }
  };

  function setupHotspots() {
    const beacons = document.querySelectorAll('.hotspot-beacon');
    const modal = document.getElementById('details-modal');
    const modalClose = document.getElementById('modal-close-btn');
    const modalTitle = document.getElementById('modal-title');
    const modalCategory = document.getElementById('modal-category');
    const modalDesc = document.getElementById('modal-desc');
    const modalSpecsGrid = document.getElementById('modal-specs-grid');

    beacons.forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const part = b.getAttribute('data-part');
        const data = HOTSPOT_DATA[part];
        if (!data) return;

        if (modalTitle) modalTitle.textContent = data.title;
        if (modalCategory) modalCategory.textContent = data.category;
        if (modalDesc) modalDesc.textContent = data.desc;

        if (modalSpecsGrid) {
          modalSpecsGrid.innerHTML = data.specs.map(s => `
            <div class="p-3 bg-white/5 border border-white/10 rounded">
              <div class="text-[10px] text-amber-400 font-mono tracking-wider uppercase">${s.label}</div>
              <div class="text-sm font-semibold text-white mt-1">${s.val}</div>
            </div>
          `).join('');
        }

        if (modal) modal.classList.add('active');
      });
    });

    if (modalClose) {
      modalClose.addEventListener('click', () => {
        if (modal) modal.classList.remove('active');
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    }
  }

  // ==========================================================================
  // 7. REAL-TIME V12 ENGINE AUDIO SYNTHESIZER (WEB AUDIO API)
  // ==========================================================================
  function initAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function startEngine() {
    initAudioContext();

    const now = audioCtx.currentTime;

    // Master Gain
    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.45, now + 1.2);
    masterGain.connect(audioCtx.destination);

    // Starter motor sound (crank chirp)
    const starterOsc = audioCtx.createOscillator();
    const starterGain = audioCtx.createGain();
    starterOsc.type = 'sawtooth';
    starterOsc.frequency.setValueAtTime(22, now);
    starterOsc.frequency.exponentialRampToValueAtTime(44, now + 0.6);
    starterGain.gain.setValueAtTime(0.3, now);
    starterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    starterOsc.connect(starterGain);
    starterGain.connect(masterGain);
    starterOsc.start(now);
    starterOsc.stop(now + 0.75);

    // 12-Cylinder Harmonic Engine Oscillators
    const fundamental = audioCtx.createOscillator();
    fundamental.type = 'sawtooth';

    const subOsc = audioCtx.createOscillator();
    subOsc.type = 'triangle';

    const highHarmonic = audioCtx.createOscillator();
    highHarmonic.type = 'sawtooth';

    // Distortion wave-shaper for throaty Italian exhaust note
    const distortion = audioCtx.createWaveShaper();
    distortion.curve = makeDistortionCurve(18);

    // Dynamic Lowpass Exhaust Filter
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, now);
    filter.Q.value = 3.5;

    // Pink noise generator for exhaust flutter and air intake
    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.11;
      b6 = white * 0.115926;
    }

    const noiseSource = audioCtx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(450, now);
    noiseFilter.Q.value = 1.8;

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.12, now);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);

    // Connect Oscillators
    fundamental.connect(distortion);
    subOsc.connect(distortion);
    highHarmonic.connect(distortion);
    distortion.connect(filter);
    filter.connect(masterGain);

    fundamental.start(now + 0.4);
    subOsc.start(now + 0.4);
    highHarmonic.start(now + 0.4);
    noiseSource.start(now + 0.4);

    engineNodes = {
      masterGain,
      fundamental,
      subOsc,
      highHarmonic,
      filter,
      noiseFilter,
      noiseGain,
      noiseSource
    };

    isEngineRunning = true;
    updateAudioFrequencies(850);
  }

  function stopEngine() {
    if (!engineNodes || !audioCtx) return;
    const now = audioCtx.currentTime;
    engineNodes.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.5);

    setTimeout(() => {
      try {
        engineNodes.fundamental.stop();
        engineNodes.subOsc.stop();
        engineNodes.highHarmonic.stop();
        engineNodes.noiseSource.stop();
        engineNodes = null;
      } catch (e) {}
    }, 550);

    isEngineRunning = false;
  }

  function makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  function updateAudioFrequencies(rpm) {
    if (!engineNodes || !audioCtx) return;

    // V12 firing frequency: (RPM / 60) * 6
    const baseFreq = (rpm / 60) * 6;
    const now = audioCtx.currentTime;

    engineNodes.fundamental.frequency.setTargetAtTime(baseFreq, now, 0.05);
    engineNodes.subOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.05);
    engineNodes.highHarmonic.frequency.setTargetAtTime(baseFreq * 2.0, now, 0.05);

    // Filter opens up as RPM climbs
    const filterCutoff = 180 + (rpm / 8000) * 2800;
    engineNodes.filter.frequency.setTargetAtTime(filterCutoff, now, 0.08);

    // Noise volume ramps up
    const noiseVol = 0.08 + (rpm / 8000) * 0.22;
    engineNodes.noiseGain.gain.setTargetAtTime(noiseVol, now, 0.05);
  }

  function setupEngineConsole() {
    const ignitionBtn = document.getElementById('ignition-btn');
    const throttleSlider = document.getElementById('throttle-slider');
    const revButton = document.getElementById('rev-pedal-btn');
    const rpmDisplay = document.getElementById('rpm-display');
    const needle = document.getElementById('tachometer-needle');
    const audioToggleNav = document.getElementById('nav-sound-toggle');
    const audioDot = document.getElementById('nav-sound-dot');
    const audioText = document.getElementById('nav-sound-text');

    function updateGauge(rpm) {
      if (rpmDisplay) rpmDisplay.textContent = Math.round(rpm);
      if (needle) {
        // 0 RPM = -120 deg, 8000 RPM = +120 deg (total 240 deg sweep)
        const degrees = -120 + (rpm / 8000) * 240;
        needle.style.transform = `rotate(${degrees}deg)`;
      }
    }

    function smoothRPM() {
      if (!isEngineRunning) {
        targetRPM = 0;
      }
      currentRPM += (targetRPM - currentRPM) * 0.15;
      updateGauge(currentRPM);
      if (isEngineRunning) {
        updateAudioFrequencies(currentRPM);
      }
      requestAnimationFrame(smoothRPM);
    }
    requestAnimationFrame(smoothRPM);

    function toggleV12Sound() {
      if (!isEngineRunning) {
        startEngine();
        targetRPM = 850 + Math.random() * 50;
        if (ignitionBtn) {
          ignitionBtn.classList.add('active');
          const lbl = ignitionBtn.querySelector('.btn-label');
          if (lbl) lbl.textContent = 'STOP';
        }
        if (audioDot) audioDot.classList.add('bg-emerald-400');
        if (audioText) audioText.textContent = 'V12 LIVE';
        const heroSnd = document.getElementById('hero-sound-btn');
        if (heroSnd) heroSnd.textContent = 'STOP V12 SOUND';
        const mobSnd = document.getElementById('mobile-sound-toggle-btn');
        if (mobSnd) mobSnd.textContent = 'STOP V12 SOUND';
      } else {
        stopEngine();
        targetRPM = 0;
        if (ignitionBtn) {
          ignitionBtn.classList.remove('active');
          const lbl = ignitionBtn.querySelector('.btn-label');
          if (lbl) lbl.textContent = 'START';
        }
        if (audioDot) audioDot.classList.remove('bg-emerald-400');
        if (audioText) audioText.textContent = 'V12 SOUND';
        const heroSnd = document.getElementById('hero-sound-btn');
        if (heroSnd) heroSnd.textContent = 'START V12 AUDIO ENGINE';
        const mobSnd = document.getElementById('mobile-sound-toggle-btn');
        if (mobSnd) mobSnd.textContent = 'START V12 SOUND';
      }
    }

    if (ignitionBtn) ignitionBtn.addEventListener('click', toggleV12Sound);
    if (audioToggleNav) audioToggleNav.addEventListener('click', toggleV12Sound);

    const heroSoundBtn = document.getElementById('hero-sound-btn');
    if (heroSoundBtn) heroSoundBtn.addEventListener('click', toggleV12Sound);

    const playbarSoundBtn = document.getElementById('playbar-sound-btn');
    if (playbarSoundBtn) playbarSoundBtn.addEventListener('click', toggleV12Sound);

    const modalSoundBtn = document.getElementById('modal-sound-btn');
    if (modalSoundBtn) modalSoundBtn.addEventListener('click', () => {
      toggleV12Sound();
      const modal = document.getElementById('details-modal');
      if (modal) modal.classList.remove('active');
    });

    const mobileSoundBtn = document.getElementById('mobile-sound-toggle-btn');
    if (mobileSoundBtn) mobileSoundBtn.addEventListener('click', toggleV12Sound);

    if (throttleSlider) {
      throttleSlider.addEventListener('input', (e) => {
        if (!isEngineRunning) return;
        const val = parseFloat(e.target.value);
        targetRPM = 850 + (val / 100) * (7800 - 850);
      });

      throttleSlider.addEventListener('change', () => {
        if (!isEngineRunning) return;
        // Return to idle
        throttleSlider.value = 0;
        targetRPM = 850;
      });
    }

    // Rev Pedal Button (Touch and Hold)
    if (revButton) {
      const startRev = (e) => {
        e.preventDefault();
        if (!isEngineRunning && ignitionBtn) {
          ignitionBtn.click();
        }
        targetRPM = 6800;
        if (throttleSlider) throttleSlider.value = 85;
      };

      const endRev = (e) => {
        e.preventDefault();
        if (isEngineRunning) {
          targetRPM = 850;
          if (throttleSlider) throttleSlider.value = 0;
        }
      };

      revButton.addEventListener('mousedown', startRev);
      window.addEventListener('mouseup', endRev);
      revButton.addEventListener('touchstart', startRev, { passive: false });
      window.addEventListener('touchend', endRev, { passive: false });
    }
  }

  // ==========================================================================
  // 8. COLOR ATELIER & ACCENT THEME SWITCHER
  // ==========================================================================
  function setupColorStudio() {
    const swatches = document.querySelectorAll('.swatch-btn');
    const colorLabel = document.getElementById('selected-color-name');
    const colorCode = document.getElementById('selected-color-code');

    swatches.forEach(btn => {
      btn.addEventListener('click', () => {
        swatches.forEach(s => s.classList.remove('active'));
        btn.classList.add('active');

        const tint = btn.getAttribute('data-tint');
        const name = btn.getAttribute('data-name');
        const code = btn.getAttribute('data-code');

        if (colorLabel) colorLabel.textContent = name;
        if (colorCode) colorCode.textContent = code;

        document.documentElement.setAttribute('data-car-tint', tint);
        renderFrame(currentFrameIndex);
      });
    });
  }

  // ==========================================================================
  // 9. TECHNICAL SPECIFICATIONS TABS
  // ==========================================================================
  function setupSpecTabs() {
    const tabBtns = document.querySelectorAll('.spec-tab-btn');
    const tabPanels = document.querySelectorAll('.spec-panel');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target');

        tabBtns.forEach(b => {
          b.classList.remove('border-amber-400', 'text-amber-400', 'bg-amber-400/10');
          b.classList.add('border-white/10', 'text-white/70');
        });
        btn.classList.remove('border-white/10', 'text-white/70');
        btn.classList.add('border-amber-400', 'text-amber-400', 'bg-amber-400/10');

        tabPanels.forEach(panel => {
          if (panel.id === target) {
            panel.classList.remove('hidden');
          } else {
            panel.classList.add('hidden');
          }
        });
      });
    });
  }

  // ==========================================================================
  // 10. VIP COMMISSIONING INQUIRY FORM
  // ==========================================================================
  function setupInquiryForm() {
    const form = document.getElementById('inquiry-form');
    const toast = document.getElementById('toast-notification');
    const toastMsg = document.getElementById('toast-message');

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();

        const nameInput = document.getElementById('vip-name');
        const clientName = nameInput ? nameInput.value : 'Esteemed Collector';

        // Show elegant confirmation toast
        if (toast && toastMsg) {
          toastMsg.innerHTML = `
            <div class="font-display font-semibold text-amber-400">DOSSIER DISPATCHED</div>
            <div class="text-xs text-white/80 mt-0.5">Thank you, ${clientName}. Our Maranello Heritage Concierge will contact you within 24 hours.</div>
          `;
          toast.classList.remove('translate-y-20', 'opacity-0');
          toast.classList.add('translate-y-0', 'opacity-100');

          setTimeout(() => {
            toast.classList.remove('translate-y-0', 'opacity-100');
            toast.classList.add('translate-y-20', 'opacity-0');
          }, 6000);
        }

        form.reset();
      });
    }

    // Newsletter form
    const newsForm = document.getElementById('newsletter-form');
    if (newsForm) {
      newsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        alert('Thank you for subscribing to the Scuderia Classiche Heritage Dispatch.');
        newsForm.reset();
      });
    }
  }

  // ==========================================================================
  // 11. KEYBOARD NAVIGATION
  // ==========================================================================
  function setupKeyboardControls() {
    window.addEventListener('keydown', (e) => {
      if (['input', 'textarea', 'select'].includes(document.activeElement.tagName.toLowerCase())) return;

      if (e.code === 'Space') {
        e.preventDefault();
        toggleAutoPlay();
      } else if (e.code === 'ArrowRight' || e.code === 'ArrowDown') {
        targetProgress = Math.min(1, targetProgress + 0.04);
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
        targetProgress = Math.max(0, targetProgress - 0.04);
      }
    });
  }

  // ==========================================================================
  // 12. MOBILE NAVIGATION DRAWER
  // ==========================================================================
  function setupMobileMenu() {
    const menuBtn = document.getElementById('mobile-menu-btn');
    const closeBtn = document.getElementById('mobile-close-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    const navLinks = document.querySelectorAll('.mobile-nav-link');

    if (menuBtn && mobileMenu) {
      menuBtn.addEventListener('click', () => {
        mobileMenu.classList.remove('opacity-0', 'pointer-events-none');
        mobileMenu.classList.add('opacity-100', 'pointer-events-auto');
      });
    }

    function closeMenu() {
      if (mobileMenu) {
        mobileMenu.classList.remove('opacity-100', 'pointer-events-auto');
        mobileMenu.classList.add('opacity-0', 'pointer-events-none');
      }
    }

    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    navLinks.forEach(link => link.addEventListener('click', closeMenu));
  }

  // ==========================================================================
  // 13. ARCHIVAL CINEMA VIDEO GLIMPSE MODAL
  // ==========================================================================
  function setupVideoModal() {
    const videoBtn = document.getElementById('video-glimpse-btn');
    const mobileVideoBtn = document.getElementById('mobile-video-btn');
    const galleryVideoTrigger = document.getElementById('gallery-video-trigger');
    const videoModal = document.getElementById('video-modal');
    const videoCloseBtn = document.getElementById('video-modal-close-btn');
    const videoElement = document.getElementById('glimpse-video');

    function openVideoModal() {
      if (videoModal) {
        videoModal.classList.add('active');
        if (videoElement) {
          videoElement.currentTime = 0;
          videoElement.play().catch(() => {});
        }
      }
    }

    function closeVideoModal() {
      if (videoModal) {
        videoModal.classList.remove('active');
        if (videoElement) {
          videoElement.pause();
        }
      }
    }

    const heroVideoBtn = document.getElementById('hero-video-btn');
    if (heroVideoBtn) heroVideoBtn.addEventListener('click', openVideoModal);
    if (videoBtn) videoBtn.addEventListener('click', openVideoModal);
    if (mobileVideoBtn) mobileVideoBtn.addEventListener('click', openVideoModal);
    if (galleryVideoTrigger) galleryVideoTrigger.addEventListener('click', openVideoModal);
    if (videoCloseBtn) videoCloseBtn.addEventListener('click', closeVideoModal);

    if (videoModal) {
      videoModal.addEventListener('click', (e) => {
        if (e.target === videoModal) closeVideoModal();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && videoModal && videoModal.classList.contains('active')) {
        closeVideoModal();
      }
    });
  }

  // ==========================================================================
  // 14. STAGE ACT BUTTON NAVIGATION
  // ==========================================================================
  function setupStageButtons() {
    const stageBtns = document.querySelectorAll('.nav-stage-btn');
    const mobileMenu = document.getElementById('mobile-menu');

    stageBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const prog = parseFloat(btn.getAttribute('data-progress') || '0');
        targetProgress = prog;
        currentProgress = prog;

        if (mobileMenu) {
          mobileMenu.classList.remove('opacity-100', 'pointer-events-auto');
          mobileMenu.classList.add('opacity-0', 'pointer-events-none');
        }

        if (revealSection) {
          const totalScrollable = revealSection.offsetHeight - window.innerHeight;
          const newScrollY = revealSection.offsetTop + (prog * totalScrollable);
          window.scrollTo({ top: newScrollY, behavior: 'smooth' });
        }
      });
    });
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  function init() {
    resizeCanvas();
    startSmartPreload();
    setupScrubber();
    setupHotspots();
    setupEngineConsole();
    setupColorStudio();
    setupSpecTabs();
    setupInquiryForm();
    setupKeyboardControls();
    setupMobileMenu();
    setupVideoModal();
    setupStageButtons();

    // Trigger initial scroll calculation
    updateScrollProgress();

    // Start RAF rendering loop
    requestAnimationFrame(renderLoop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
