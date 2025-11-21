"use strict";

// --- PIXI JS SETUP ---
let app;
let mainGraphics;
let stageW, stageH;

// --- GLOBAL VARIABLES & CONSTANTS ---
const IS_MOBILE = window.innerWidth <= 640;
const IS_DESKTOP = window.innerWidth > 800;
const IS_HEADER = IS_DESKTOP && window.innerHeight < 300;
const IS_HIGH_END_DEVICE = (() => {
  const hwConcurrency = navigator.hardwareConcurrency;
  if (!hwConcurrency) return false;
  const minCount = window.innerWidth <= 1024 ? 4 : 8;
  return hwConcurrency >= minCount;
})();

const GRAVITY = 0.9;
let simSpeed = 1;

// Quality globals
let quality = 1;
let isLowQuality = false;
let isNormalQuality = false;
let isHighQuality = true;

const QUALITY_LOW = 1;
const QUALITY_NORMAL = 2;
const QUALITY_HIGH = 3;

const SKY_LIGHT_NONE = 0;
const SKY_LIGHT_DIM = 1;
const SKY_LIGHT_NORMAL = 2;

const COLOR = {
  Red: "#ff0043",
  Green: "#14fc56",
  Blue: "#1e7fff",
  Purple: "#e60aff",
  Gold: "#ffbf36",
  White: "#ffffff",
};
const INVISIBLE = "_INVISIBLE_";
const PI_2 = Math.PI * 2;
const PI_HALF = Math.PI * 0.5;

// 定义金色的整数值
const GOLD_INT = 0xffbf36;

// Word Shell - 日本語
const randomWords = ["謹賀新年", "花火大会", "心願成就", "大願成就", "美しい"];

// --- STORE & STATE MANAGEMENT ---
const store = {
  state: {
    paused: true,
    soundEnabled: true,
    menuOpen: false,
    fullscreen: false,
    config: {
      quality: String(IS_HIGH_END_DEVICE ? QUALITY_HIGH : QUALITY_NORMAL),
      shell: "Random",
      size: IS_DESKTOP ? "3" : IS_HEADER ? "1.2" : "2",
      wordShell: true,
      autoLaunch: true,
      finale: true,
      skyLighting: SKY_LIGHT_NORMAL + "",
      hideControls: IS_HEADER,
      longExposure: false,
      scaleFactor: IS_MOBILE ? 0.9 : 1,
    },
  },
  setState(nextState) {
    this.state = Object.assign({}, this.state, nextState);
    renderApp(this.state);
    persist();
  },
  load() {
    const serializedData = localStorage.getItem("cm_fireworks_data");
    if (serializedData) {
      try {
        const { data } = JSON.parse(serializedData);
        if (data) Object.assign(this.state.config, data);
      } catch (e) {
        console.error("Config load error", e);
      }
    }
  },
};

function persist() {
  localStorage.setItem(
    "cm_fireworks_data",
    JSON.stringify({
      schemaVersion: "1.2",
      data: store.state.config,
    })
  );
}

// --- APP INITIALIZATION ---
async function initApp() {
  // 1. Initialize Pixi Application
  app = new PIXI.Application();

  await app.init({
    background: "#000000",
    resizeTo: window,
    antialias: false,
    preference: "webgl",
    preserveDrawingBuffer: true, // 关键：开启以支持手动清除
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });

  document.querySelector(".canvas-container").appendChild(app.canvas);

  mainGraphics = new PIXI.Graphics();
  app.stage.addChild(mainGraphics);

  // 3. Setup Resize Listener
  window.addEventListener("resize", handleResize);
  handleResize();

  // 4. Setup Input
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  app.stage.on("pointerdown", handlePointerStart);
  app.stage.on("pointerup", handlePointerEnd);
  app.stage.on("pointermove", handlePointerMove);
  window.addEventListener("keydown", handleKeydown);

  // 5. Initialize Logic
  store.load();
  initUI();

  // 6. Preload Audio (with error handling)
  document.querySelector(".loading-init__status").textContent =
    "音声を読み込んでいます...";
  try {
    await soundManager.preload();
  } catch (e) {
    console.warn(
      "Audio loading skipped due to error (CORS or missing files). App will run silently.",
      e
    );
  }

  // 7. Start Loop - Force removal of loading screen
  const loader = document.querySelector(".loading-init");
  if (loader) loader.remove();

  document.querySelector(".controls").classList.remove("hide");

  app.ticker.add((ticker) => {
    update(ticker.deltaMS, ticker.deltaTime);
  });

  togglePause(false);
  configDidUpdate();
}

// --- RESIZE HANDLING ---
function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  stageW = w / scaleFactorSelector();
  stageH = h / scaleFactorSelector();

  if (app && app.stage) {
    app.stage.scale.set(scaleFactorSelector());
  }
}

// --- LOGIC & UPDATE LOOP ---

let currentFrame = 0;
let speedBarOpacity = 0;
let autoLaunchTime = 0;

function update(frameTime, lag) {
  if (!isRunning()) return;

  // Clear graphics for immediate mode drawing
  mainGraphics.clear();

  const timeStep = frameTime * simSpeed;
  const speed = simSpeed * lag;

  // Update Globals
  currentFrame++;
  if (!isUpdatingSpeed) {
    speedBarOpacity -= lag / 30;
    if (speedBarOpacity < 0) speedBarOpacity = 0;
  }
  if (store.state.config.autoLaunch) {
    autoLaunchTime -= timeStep;
    if (autoLaunchTime <= 0) {
      autoLaunchTime = startSequence() * 1.25;
    }
  }

  // Physics Constants
  const starDrag = 1 - (1 - Star.airDrag) * speed;
  const starDragHeavy = 1 - (1 - Star.airDragHeavy) * speed;
  const sparkDrag = 1 - (1 - Spark.airDrag) * speed;
  const gAcc = (timeStep / 1000) * GRAVITY;

  // --- DRAWING: BACKGROUND FADE ---
  // 重要：手动绘制半透明黑色层以模拟拖尾效果
  // Pixi renderer 默认会在每一帧开始时清空屏幕，但因为设置了 preserveDrawingBuffer=true
  // 我们可以控制"清除"的程度。
  app.renderer.clearBeforeRender = false;

  const fadeAlpha = store.state.config.longExposure ? 0.0025 : 0.175 * speed;
  mainGraphics.rect(
    0,
    0,
    (stageW / scaleFactorSelector()) * 2,
    (stageH / scaleFactorSelector()) * 2
  );
  mainGraphics.fill({ color: 0x000000, alpha: fadeAlpha });

  // Sky lighting
  if (skyLightingSelector() !== SKY_LIGHT_NONE) {
    colorSky(speed);
  }

  // --- PHYSICS & DRAWING PARTICLES ---

  // Draw Stars
  COLOR_CODES_W_INVIS.forEach((colorStr) => {
    const stars = Star.active[colorStr];
    const colorInt =
      colorStr === INVISIBLE ? 0x000000 : parseInt(colorStr.replace("#", "0x"));

    for (let i = stars.length - 1; i >= 0; i--) {
      const star = stars[i];

      star.life -= timeStep;
      if (star.life <= 0) {
        stars.splice(i, 1);
        Star.returnInstance(star);
      } else {
        star.prevX = star.x;
        star.prevY = star.y;
        star.x += star.speedX * speed;
        star.y += star.speedY * speed;

        // Physics
        if (!star.heavy) {
          star.speedX *= starDrag;
          star.speedY *= starDrag;
        } else {
          star.speedX *= starDragHeavy;
          star.speedY *= starDragHeavy;
        }
        star.speedY += gAcc;

        if (star.spinRadius) {
          star.spinAngle += star.spinSpeed * speed;
          star.x += Math.sin(star.spinAngle) * star.spinRadius * speed;
          star.y += Math.cos(star.spinAngle) * star.spinRadius * speed;
        }

        if (star.sparkFreq) {
          star.sparkTimer -= timeStep;
          while (star.sparkTimer < 0) {
            star.sparkTimer +=
              star.sparkFreq * 0.75 +
              star.sparkFreq *
                (1 - Math.pow(star.life / star.fullLife, 0.5)) *
                4;
            Spark.add(
              star.x,
              star.y,
              star.sparkColor,
              Math.random() * PI_2,
              Math.random() * star.sparkSpeed,
              star.sparkLife * 0.8 +
                Math.random() * star.sparkLifeVariation * star.sparkLife
            );
          }
        }

        // Drawing Star Line
        if (star.visible) {
          mainGraphics.moveTo(star.prevX, star.prevY);
          mainGraphics.lineTo(star.x, star.y);
          mainGraphics.stroke({
            width: star.size,
            color: colorInt,
            alpha: 1,
            cap: "round",
          });
        }

        // Lifecycle events
        if (star.life < star.transitionTime) {
          if (star.secondColor && !star.colorChanged) {
            star.colorChanged = true;
            star.color = star.secondColor;
            stars.splice(i, 1);
            Star.active[star.secondColor].push(star);
            if (star.secondColor === INVISIBLE) star.sparkFreq = 0;
          }
          if (star.strobe) {
            star.visible = Math.floor(star.life / star.strobeFreq) % 3 === 0;
          }
        }
      }
    }

    // Draw Sparks
    const sparks = Spark.active[colorStr];
    const sparkColorInt = colorStr === INVISIBLE ? GOLD_INT : colorInt;

    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      spark.life -= timeStep;
      if (spark.life <= 0) {
        sparks.splice(i, 1);
        Spark.returnInstance(spark);
      } else {
        spark.prevX = spark.x;
        spark.prevY = spark.y;
        spark.x += spark.speedX * speed;
        spark.y += spark.speedY * speed;
        spark.speedX *= sparkDrag;
        spark.speedY *= sparkDrag;
        spark.speedY += gAcc;

        // Draw Spark
        mainGraphics.moveTo(spark.prevX, spark.prevY);
        mainGraphics.lineTo(spark.x, spark.y);
        mainGraphics.stroke({
          width: Spark.drawWidth,
          color: sparkColorInt,
          alpha: 1,
        });
      }
    }
  });

  // Draw Burst Flashes
  while (BurstFlash.active.length) {
    const bf = BurstFlash.active.pop();
    mainGraphics.circle(bf.x, bf.y, bf.radius);
    mainGraphics.fill({ color: 0xffffff, alpha: 0.25 });
    BurstFlash.returnInstance(bf);
  }

  // Speed Bar
  if (speedBarOpacity) {
    mainGraphics.rect(0, stageH - 6, stageW * simSpeed, 6);
    mainGraphics.fill({ color: 0x1e7fff, alpha: speedBarOpacity });
  }
}

// --- COLOR & HELPERS ---

const COLOR_NAMES = Object.keys(COLOR);
const COLOR_CODES = COLOR_NAMES.map((name) => COLOR[name]);
const COLOR_CODES_W_INVIS = [...COLOR_CODES, INVISIBLE];
const COLOR_TUPLES = {};
COLOR_CODES.forEach((hex) => {
  COLOR_TUPLES[hex] = {
    r: parseInt(hex.substr(1, 2), 16),
    g: parseInt(hex.substr(3, 2), 16),
    b: parseInt(hex.substr(5, 2), 16),
  };
});

function randomColorSimple() {
  return COLOR_CODES[Math.floor(Math.random() * COLOR_CODES.length)];
}

let lastColor;
function randomColor(options) {
  const notSame = options && options.notSame;
  const notColor = options && options.notColor;
  const limitWhite = options && options.limitWhite;
  let color = randomColorSimple();

  if (limitWhite && color === COLOR.White && Math.random() < 0.6)
    color = randomColorSimple();
  if (notSame) {
    while (color === lastColor) color = randomColorSimple();
  } else if (notColor) {
    while (color === notColor) color = randomColorSimple();
  }

  lastColor = color;
  return color;
}

function whiteOrGold() {
  return Math.random() < 0.5 ? COLOR.Gold : COLOR.White;
}
function makePistilColor(shellColor) {
  return shellColor === COLOR.White || shellColor === COLOR.Gold
    ? randomColor({ notColor: shellColor })
    : whiteOrGold();
}
function randomWord() {
  if (randomWords.length === 0) return "";
  return randomWords[Math.floor(Math.random() * randomWords.length)];
}

// --- SHELL DEFINITIONS ---
const crysanthemumShell = (size = 1) => {
  const glitter = Math.random() < 0.25;
  const singleColor = Math.random() < 0.72;
  const color = singleColor
    ? randomColor({ limitWhite: true })
    : [randomColor(), randomColor({ notSame: true })];
  const pistil = singleColor && Math.random() < 0.42;
  const pistilColor = pistil && makePistilColor(color);
  const secondColor =
    singleColor && (Math.random() < 0.2 || color === COLOR.White)
      ? pistilColor || randomColor({ notColor: color, limitWhite: true })
      : null;
  const streamers = !pistil && color !== COLOR.White && Math.random() < 0.42;
  let starDensity = glitter ? 1.1 : 1.25;
  if (isLowQuality) starDensity *= 0.8;
  if (isHighQuality) starDensity = 1.2;
  return {
    shellSize: size,
    spreadSize: 300 + size * 100,
    starLife: 900 + size * 200,
    starDensity,
    color,
    secondColor,
    glitter: glitter ? "light" : "",
    glitterColor: whiteOrGold(),
    pistil,
    pistilColor,
    streamers,
  };
};

const ghostShell = (size = 1) => {
  const shell = crysanthemumShell(size);
  shell.starLife *= 1.5;
  let ghostColor = randomColor({ notColor: COLOR.White });
  shell.streamers = true;
  const pistil = Math.random() < 0.42;
  shell.color = INVISIBLE;
  shell.secondColor = ghostColor;
  shell.glitter = "";
  return shell;
};

const strobeShell = (size = 1) => {
  const color = randomColor({ limitWhite: true });
  return {
    shellSize: size,
    spreadSize: 280 + size * 92,
    starLife: 1100 + size * 200,
    starLifeVariation: 0.4,
    starDensity: 1.1,
    color,
    glitter: "light",
    glitterColor: COLOR.White,
    strobe: true,
    strobeColor: Math.random() < 0.5 ? COLOR.White : null,
    pistil: Math.random() < 0.5,
    pistilColor: makePistilColor(color),
  };
};

const palmShell = (size = 1) => {
  const color = randomColor();
  const thick = Math.random() < 0.5;
  return {
    shellSize: size,
    color,
    spreadSize: 250 + size * 75,
    starDensity: thick ? 0.15 : 0.4,
    starLife: 1800 + size * 200,
    glitter: thick ? "thick" : "heavy",
  };
};

const ringShell = (size = 1) => {
  const color = randomColor();
  const pistil = Math.random() < 0.75;
  return {
    shellSize: size,
    ring: true,
    color,
    spreadSize: 300 + size * 100,
    starLife: 900 + size * 200,
    starCount: 2.2 * PI_2 * (size + 1),
    pistil,
    pistilColor: makePistilColor(color),
    glitter: !pistil ? "light" : "",
    glitterColor: color === COLOR.Gold ? COLOR.Gold : COLOR.White,
    streamers: Math.random() < 0.3,
  };
};

const crossetteShell = (size = 1) => {
  const color = randomColor({ limitWhite: true });
  return {
    shellSize: size,
    spreadSize: 300 + size * 100,
    starLife: 750 + size * 160,
    starLifeVariation: 0.4,
    starDensity: 0.85,
    color,
    crossette: true,
    pistil: Math.random() < 0.5,
    pistilColor: makePistilColor(color),
  };
};

const floralShell = (size = 1) => ({
  shellSize: size,
  spreadSize: 300 + size * 120,
  starDensity: 0.12,
  starLife: 500 + size * 50,
  starLifeVariation: 0.5,
  color:
    Math.random() < 0.65
      ? "random"
      : Math.random() < 0.15
      ? randomColor()
      : [randomColor(), randomColor({ notSame: true })],
  floral: true,
});

const fallingLeavesShell = (size = 1) => ({
  shellSize: size,
  color: INVISIBLE,
  spreadSize: 300 + size * 120,
  starDensity: 0.12,
  starLife: 500 + size * 50,
  starLifeVariation: 0.5,
  glitter: "medium",
  glitterColor: COLOR.Gold,
  fallingLeaves: true,
});

const willowShell = (size = 1) => ({
  shellSize: size,
  spreadSize: 300 + size * 100,
  starDensity: 0.6,
  starLife: 3000 + size * 300,
  glitter: "willow",
  glitterColor: COLOR.Gold,
  color: INVISIBLE,
});

const crackleShell = (size = 1) => {
  const color = Math.random() < 0.75 ? COLOR.Gold : randomColor();
  return {
    shellSize: size,
    spreadSize: 380 + size * 75,
    starDensity: isLowQuality ? 0.65 : 1,
    starLife: 600 + size * 100,
    starLifeVariation: 0.32,
    glitter: "light",
    glitterColor: COLOR.Gold,
    color,
    crackle: true,
    pistil: Math.random() < 0.65,
    pistilColor: makePistilColor(color),
  };
};

const horsetailShell = (size = 1) => {
  const color = randomColor();
  return {
    shellSize: size,
    horsetail: true,
    color,
    spreadSize: 250 + size * 38,
    starDensity: 0.9,
    starLife: 2500 + size * 300,
    glitter: "medium",
    glitterColor: Math.random() < 0.5 ? whiteOrGold() : color,
    strobe: color === COLOR.White,
  };
};

function randomShellName() {
  return Math.random() < 0.5
    ? "Crysanthemum"
    : shellNames[(Math.random() * (shellNames.length - 1) + 1) | 0];
}
function randomShell(size) {
  return IS_HEADER
    ? randomFastShell()(size)
    : shellTypes[randomShellName()](size);
}
function shellFromConfig(size) {
  return shellTypes[shellNameSelector()](size);
}

const fastShellBlacklist = ["Falling Leaves", "Floral", "Willow"];
function randomFastShell() {
  const isRandom = shellNameSelector() === "Random";
  let shellName = isRandom ? randomShellName() : shellNameSelector();
  if (isRandom) {
    while (fastShellBlacklist.includes(shellName))
      shellName = randomShellName();
  }
  return shellTypes[shellName];
}

const shellTypes = {
  Random: randomShell,
  Crackle: crackleShell,
  Crossette: crossetteShell,
  Crysanthemum: crysanthemumShell,
  "Falling Leaves": fallingLeavesShell,
  Floral: floralShell,
  Ghost: ghostShell,
  "Horse Tail": horsetailShell,
  Palm: palmShell,
  Ring: ringShell,
  Strobe: strobeShell,
  Willow: willowShell,
};
const shellNames = Object.keys(shellTypes);

// --- ENTITIES & FACTORIES ---

class Shell {
  constructor(options) {
    Object.assign(this, options);
    this.starLifeVariation = options.starLifeVariation || 0.125;
    this.color = options.color || randomColor();
    this.glitterColor = options.glitterColor || this.color;
    this.disableWord = options.disableWord || false;
    if (!this.starCount) {
      const density = options.starDensity || 1;
      const scaledSize = this.spreadSize / 54;
      this.starCount = Math.max(6, scaledSize * scaledSize * density);
    }
  }
  launch(position, launchHeight) {
    const hpad = 60;
    const vpad = 50;
    const minHeightPercent = 0.45;
    const minHeight = stageH - stageH * minHeightPercent;
    const launchX = position * (stageW - hpad * 2) + hpad;
    const launchY = stageH;
    const burstY = minHeight - launchHeight * (minHeight - vpad);
    const launchDistance = launchY - burstY;
    const launchVelocity = Math.pow(launchDistance * 0.04, 0.64);

    const comet = (this.comet = Star.add(
      launchX,
      launchY,
      typeof this.color === "string" && this.color !== "random"
        ? this.color
        : COLOR.White,
      Math.PI,
      launchVelocity * (this.horsetail ? 1.2 : 1),
      launchVelocity * (this.horsetail ? 100 : 400)
    ));
    comet.heavy = true;
    comet.spinRadius = MyMath.random(0.32, 0.85);
    comet.sparkFreq = isHighQuality ? 8 : 32 / quality;
    comet.sparkLife = 320;
    comet.sparkLifeVariation = 3;
    if (this.glitter === "willow" || this.fallingLeaves) {
      comet.sparkFreq = 20 / quality;
      comet.sparkSpeed = 0.5;
      comet.sparkLife = 500;
    }
    if (this.color === INVISIBLE) comet.sparkColor = COLOR.Gold;
    if (Math.random() > 0.4 && !this.horsetail) {
      comet.secondColor = INVISIBLE;
      comet.transitionTime = Math.pow(Math.random(), 1.5) * 700 + 500;
    }
    comet.onDeath = (c) => this.burst(c.x, c.y);
    soundManager.playSound("lift");
  }
  burst(x, y) {
    const speed = this.spreadSize / 96;
    let color, onDeath, sparkFreq, sparkSpeed, sparkLife;
    let sparkLifeVariation = 0.25;
    let playedDeathSound = false;

    if (this.crossette)
      onDeath = (star) => {
        if (!playedDeathSound) {
          soundManager.playSound("crackleSmall");
          playedDeathSound = true;
        }
        crossetteEffect(star);
      };
    if (this.crackle)
      onDeath = (star) => {
        if (!playedDeathSound) {
          soundManager.playSound("crackle");
          playedDeathSound = true;
        }
        crackleEffect(star);
      };
    if (this.floral) onDeath = floralEffect;
    if (this.fallingLeaves) onDeath = fallingLeavesEffect;

    if (this.glitter === "light") {
      sparkFreq = 400;
      sparkSpeed = 0.3;
      sparkLife = 300;
      sparkLifeVariation = 2;
    } else if (this.glitter === "medium") {
      sparkFreq = 200;
      sparkSpeed = 0.44;
      sparkLife = 700;
      sparkLifeVariation = 2;
    } else if (this.glitter === "heavy") {
      sparkFreq = 80;
      sparkSpeed = 0.8;
      sparkLife = 1400;
      sparkLifeVariation = 2;
    } else if (this.glitter === "thick") {
      sparkFreq = 16;
      sparkSpeed = isHighQuality ? 1.65 : 1.5;
      sparkLife = 1400;
      sparkLifeVariation = 3;
    } else if (this.glitter === "streamer") {
      sparkFreq = 32;
      sparkSpeed = 1.05;
      sparkLife = 620;
      sparkLifeVariation = 2;
    } else if (this.glitter === "willow") {
      sparkFreq = 120;
      sparkSpeed = 0.34;
      sparkLife = 1400;
      sparkLifeVariation = 3.8;
    }

    sparkFreq = sparkFreq / quality;

    const starFactory = (angle, speedMult) => {
      const standardInitialSpeed = this.spreadSize / 1800;
      const star = Star.add(
        x,
        y,
        color || randomColor(),
        angle,
        speedMult * speed,
        this.starLife + Math.random() * this.starLife * this.starLifeVariation,
        this.horsetail ? this.comet && this.comet.speedX : 0,
        this.horsetail ? this.comet && this.comet.speedY : -standardInitialSpeed
      );
      if (this.secondColor) {
        star.transitionTime = this.starLife * (Math.random() * 0.05 + 0.32);
        star.secondColor = this.secondColor;
      }
      if (this.strobe) {
        star.transitionTime = this.starLife * (Math.random() * 0.08 + 0.46);
        star.strobe = true;
        star.strobeFreq = Math.random() * 20 + 40;
        if (this.strobeColor) star.secondColor = this.strobeColor;
      }
      star.onDeath = onDeath;
      if (this.glitter) {
        star.sparkFreq = sparkFreq;
        star.sparkSpeed = sparkSpeed;
        star.sparkLife = sparkLife;
        star.sparkLifeVariation = sparkLifeVariation;
        star.sparkColor = this.glitterColor;
        star.sparkTimer = Math.random() * star.sparkFreq;
      }
    };

    const dotStarFactory = (point, color, strobe, strobeColor) => {
      const standardInitialSpeed = this.spreadSize / 1800;
      if (strobe) {
        let speed = Math.random() * 0.1 + 0.05;
        const star = Star.add(
          point.x,
          point.y,
          color,
          Math.random() * 2 * Math.PI,
          speed,
          this.starLife +
            Math.random() * this.starLife * this.starLifeVariation +
            speed * 1000,
          this.horsetail ? this.comet?.speedX : 0,
          this.horsetail ? this.comet?.speedY : -standardInitialSpeed,
          2
        );
        star.transitionTime = this.starLife * (Math.random() * 0.08 + 0.46);
        star.strobe = true;
        star.strobeFreq = Math.random() * 20 + 40;
        star.secondColor = strobeColor;
      } else {
        Spark.add(
          point.x,
          point.y,
          color,
          Math.random() * 2 * Math.PI,
          Math.pow(Math.random(), 0.15) * 1.4,
          this.starLife +
            Math.random() * this.starLife * this.starLifeVariation +
            1000
        );
      }
      Spark.add(
        point.x + 5,
        point.y + 10,
        color,
        Math.random() * 2 * Math.PI,
        Math.pow(Math.random(), 0.05) * 0.4,
        this.starLife +
          Math.random() * this.starLife * this.starLifeVariation +
          2000
      );
    };

    if (typeof this.color === "string") {
      if (this.color === "random") color = null;
      else color = this.color;
      if (this.ring) {
        const ringStartAngle = Math.random() * Math.PI;
        const ringSquash = Math.pow(Math.random(), 2) * 0.85 + 0.15;
        createParticleArc(0, PI_2, this.starCount, 0, (angle) => {
          const initSpeedX = Math.sin(angle) * speed * ringSquash;
          const initSpeedY = Math.cos(angle) * speed;
          const newSpeed = MyMath.pointDist(0, 0, initSpeedX, initSpeedY);
          const newAngle =
            MyMath.pointAngle(0, 0, initSpeedX, initSpeedY) + ringStartAngle;
          const star = Star.add(
            x,
            y,
            color,
            newAngle,
            newSpeed,
            this.starLife +
              Math.random() * this.starLife * this.starLifeVariation
          );
          if (this.glitter) {
            star.sparkFreq = sparkFreq;
            star.sparkSpeed = sparkSpeed;
            star.sparkLife = sparkLife;
            star.sparkLifeVariation = sparkLifeVariation;
            star.sparkColor = this.glitterColor;
            star.sparkTimer = Math.random() * star.sparkFreq;
          }
        });
      } else {
        createBurst(this.starCount, starFactory);
      }
    } else if (Array.isArray(this.color)) {
      if (Math.random() < 0.5) {
        const start = Math.random() * Math.PI;
        const start2 = start + Math.PI;
        const arc = Math.PI;
        color = this.color[0];
        createBurst(this.starCount, starFactory, start, arc);
        color = this.color[1];
        createBurst(this.starCount, starFactory, start2, arc);
      } else {
        color = this.color[0];
        createBurst(this.starCount / 2, starFactory);
        color = this.color[1];
        createBurst(this.starCount / 2, starFactory);
      }
    }

    if (!this.disableWord && store.state.config.wordShell) {
      if (Math.random() < 0.1) {
        if (Math.random() < 0.5) {
          createWordBurst(randomWord(), dotStarFactory, x, y);
        }
      }
    }

    if (this.pistil) {
      const innerShell = new Shell({
        spreadSize: this.spreadSize * 0.5,
        starLife: this.starLife * 0.6,
        starLifeVariation: this.starLifeVariation,
        starDensity: 1.4,
        color: this.pistilColor,
        glitter: "light",
        disableWord: true,
        glitterColor:
          this.pistilColor === COLOR.Gold ? COLOR.Gold : COLOR.White,
      });
      innerShell.burst(x, y);
    }

    if (this.streamers) {
      const innerShell = new Shell({
        spreadSize: this.spreadSize * 0.9,
        starLife: this.starLife * 0.8,
        starLifeVariation: this.starLifeVariation,
        starCount: Math.floor(Math.max(6, this.spreadSize / 45)),
        color: COLOR.White,
        disableWord: true,
        glitter: "streamer",
      });
      innerShell.burst(x, y);
    }

    BurstFlash.add(x, y, this.spreadSize / 4);

    if (this.comet) {
      const maxDiff = 2;
      const sizeDifferenceFromMaxSize = Math.min(
        maxDiff,
        shellSizeSelector() - this.shellSize
      );
      const soundScale = (1 - sizeDifferenceFromMaxSize / maxDiff) * 0.3 + 0.7;
      soundManager.playSound("burst", soundScale);
    }
  }
}

// Effects
function crossetteEffect(star) {
  createParticleArc(Math.random() * PI_HALF, PI_2, 4, 0.5, (angle) => {
    Star.add(
      star.x,
      star.y,
      star.color,
      angle,
      Math.random() * 0.6 + 0.75,
      600
    );
  });
}
function floralEffect(star) {
  createBurst(12 + 6 * quality, (angle, speedMult) => {
    Star.add(
      star.x,
      star.y,
      star.color,
      angle,
      speedMult * 2.4,
      1000 + Math.random() * 300,
      star.speedX,
      star.speedY
    );
  });
  BurstFlash.add(star.x, star.y, 46);
  soundManager.playSound("burstSmall");
}
function fallingLeavesEffect(star) {
  createBurst(7, (angle, speedMult) => {
    const newStar = Star.add(
      star.x,
      star.y,
      INVISIBLE,
      angle,
      speedMult * 2.4,
      2400 + Math.random() * 600,
      star.speedX,
      star.speedY
    );
    newStar.sparkColor = COLOR.Gold;
    newStar.sparkFreq = 144 / quality;
    newStar.sparkSpeed = 0.28;
    newStar.sparkLife = 750;
    newStar.sparkLifeVariation = 3.2;
  });
  BurstFlash.add(star.x, star.y, 46);
  soundManager.playSound("burstSmall");
}
function crackleEffect(star) {
  createParticleArc(0, PI_2, isHighQuality ? 32 : 16, 1.8, (angle) => {
    Spark.add(
      star.x,
      star.y,
      COLOR.Gold,
      angle,
      Math.pow(Math.random(), 0.45) * 2.4,
      300 + Math.random() * 200
    );
  });
}

// Particle System
const Star = {
  airDrag: 0.98,
  airDragHeavy: 0.992,
  active: {},
  _pool: [],
  _new() {
    return {};
  },
  add(x, y, color, angle, speed, life, speedOffX, speedOffY, size = 3) {
    const instance = this._pool.pop() || this._new();
    instance.visible = true;
    instance.heavy = false;
    instance.x = x;
    instance.y = y;
    instance.prevX = x;
    instance.prevY = y;
    instance.color = color;
    instance.speedX = Math.sin(angle) * speed + (speedOffX || 0);
    instance.speedY = Math.cos(angle) * speed + (speedOffY || 0);
    instance.life = life;
    instance.fullLife = life;
    instance.size = size;
    instance.spinAngle = Math.random() * PI_2;
    instance.spinSpeed = 0.8;
    instance.spinRadius = 0;
    instance.sparkFreq = 0;
    instance.sparkSpeed = 1;
    instance.sparkTimer = 0;
    instance.sparkColor = color;
    instance.sparkLife = 750;
    instance.sparkLifeVariation = 0.25;
    instance.strobe = false;
    if (!this.active[color]) this.active[color] = [];
    this.active[color].push(instance);
    return instance;
  },
  returnInstance(instance) {
    instance.onDeath && instance.onDeath(instance);
    instance.onDeath = null;
    instance.secondColor = null;
    instance.transitionTime = 0;
    instance.colorChanged = false;
    this._pool.push(instance);
  },
};
Object.keys(COLOR).forEach((k) => {
  Star.active[COLOR[k]] = [];
});
Star.active[INVISIBLE] = [];

const Spark = {
  drawWidth: 0,
  airDrag: 0.9,
  active: {},
  _pool: [],
  _new() {
    return {};
  },
  add(x, y, color, angle, speed, life) {
    const instance = this._pool.pop() || this._new();
    instance.x = x;
    instance.y = y;
    instance.prevX = x;
    instance.prevY = y;
    instance.color = color;
    instance.speedX = Math.sin(angle) * speed;
    instance.speedY = Math.cos(angle) * speed;
    instance.life = life;
    if (!this.active[color]) this.active[color] = [];
    this.active[color].push(instance);
    return instance;
  },
  returnInstance(instance) {
    this._pool.push(instance);
  },
};
Object.keys(COLOR).forEach((k) => {
  Spark.active[COLOR[k]] = [];
});

const BurstFlash = {
  active: [],
  _pool: [],
  _new() {
    return {};
  },
  add(x, y, radius) {
    const instance = this._pool.pop() || this._new();
    instance.x = x;
    instance.y = y;
    instance.radius = radius;
    this.active.push(instance);
    return instance;
  },
  returnInstance(instance) {
    this._pool.push(instance);
  },
};

// Utils
function createParticleArc(
  start,
  arcLength,
  count,
  randomness,
  particleFactory
) {
  const angleDelta = arcLength / count;
  const end = start + arcLength - angleDelta * 0.5;
  if (end > start) {
    for (let angle = start; angle < end; angle = angle + angleDelta)
      particleFactory(angle + Math.random() * angleDelta * randomness);
  } else {
    for (let angle = start; angle > end; angle = angle + angleDelta)
      particleFactory(angle + Math.random() * angleDelta * randomness);
  }
}
function createBurst(count, particleFactory, startAngle = 0, arcLength = PI_2) {
  const R = 0.5 * Math.sqrt(count / Math.PI);
  const C = 2 * R * Math.PI;
  const C_HALF = C / 2;
  for (let i = 0; i <= C_HALF; i++) {
    const ringAngle = (i / C_HALF) * PI_HALF;
    const ringSize = Math.cos(ringAngle);
    const partsPerFullRing = C * ringSize;
    const partsPerArc = partsPerFullRing * (arcLength / PI_2);
    const angleInc = PI_2 / partsPerFullRing;
    const angleOffset = Math.random() * angleInc + startAngle;
    const maxRandomAngleOffset = angleInc * 0.33;
    for (let j = 0; j < partsPerArc; j++) {
      const randomAngleOffset = Math.random() * maxRandomAngleOffset;
      let angle = angleInc * j + angleOffset + randomAngleOffset;
      particleFactory(angle, ringSize);
    }
  }
}
function getWordDots(word) {
  if (!word) return null;
  let fontSize = Math.floor(Math.random() * 70 + 60);
  // 使用更通用的字体
  return MyMath.literalLattice(word, 3, "sans-serif", fontSize + "px");
}
function createWordBurst(wordText, particleFactory, center_x, center_y) {
  let map = getWordDots(wordText);
  if (!map) return;
  let dcenterX = map.width / 2;
  let dcenterY = map.height / 2;
  let color = randomColor();
  let strobed = Math.random() < 0.5;
  let strobeColor = strobed ? randomColor() : color;
  for (let i = 0; i < map.points.length; i++) {
    const point = map.points[i];
    let x = center_x + (point.x - dcenterX);
    let y = center_y + (point.y - dcenterY);
    particleFactory({ x, y }, color, strobed, strobeColor);
  }
}

// Sky Color - 修复版
const currentSkyColor = { r: 0, g: 0, b: 0 };
const targetSkyColor = { r: 0, g: 0, b: 0 };
function colorSky(speed) {
  const maxSkySaturation = skyLightingSelector() * 15;
  const maxStarCount = 500;
  let totalStarCount = 0;
  targetSkyColor.r = 0;
  targetSkyColor.g = 0;
  targetSkyColor.b = 0;
  COLOR_CODES.forEach((color) => {
    const tuple = COLOR_TUPLES[color];
    const count = Star.active[color].length;
    totalStarCount += count;
    targetSkyColor.r += tuple.r * count;
    targetSkyColor.g += tuple.g * count;
    targetSkyColor.b += tuple.b * count;
  });
  const intensity = Math.pow(Math.min(1, totalStarCount / maxStarCount), 0.3);
  const maxColorComponent = Math.max(
    1,
    targetSkyColor.r,
    targetSkyColor.g,
    targetSkyColor.b
  );
  targetSkyColor.r =
    (targetSkyColor.r / maxColorComponent) * maxSkySaturation * intensity;
  targetSkyColor.g =
    (targetSkyColor.g / maxColorComponent) * maxSkySaturation * intensity;
  targetSkyColor.b =
    (targetSkyColor.b / maxColorComponent) * maxSkySaturation * intensity;
  const colorChange = 10;
  currentSkyColor.r +=
    ((targetSkyColor.r - currentSkyColor.r) / colorChange) * speed;
  currentSkyColor.g +=
    ((targetSkyColor.g - currentSkyColor.g) / colorChange) * speed;
  currentSkyColor.b +=
    ((targetSkyColor.b - currentSkyColor.b) / colorChange) * speed;

  // FIX: 使用标准 CSS 字符串设置颜色，兼容 Pixi v8
  app.renderer.background.color = `rgb(${currentSkyColor.r | 0}, ${
    currentSkyColor.g | 0
  }, ${currentSkyColor.b | 0})`;
}

// --- SEQUENCER ---
function fitShellPositionInBoundsH(position) {
  const edge = 0.18;
  return (1 - edge * 2) * position + edge;
}
function fitShellPositionInBoundsV(position) {
  return position * 0.75;
}
function getRandomShellPositionH() {
  return fitShellPositionInBoundsH(Math.random());
}
function getRandomShellPositionV() {
  return fitShellPositionInBoundsV(Math.random());
}
function getRandomShellSize() {
  const baseSize = shellSizeSelector();
  const maxVariance = Math.min(2.5, baseSize);
  const variance = Math.random() * maxVariance;
  const size = baseSize - variance;
  const height = maxVariance === 0 ? Math.random() : 1 - variance / maxVariance;
  const centerOffset = Math.random() * (1 - height * 0.65) * 0.5;
  const x = Math.random() < 0.5 ? 0.5 - centerOffset : 0.5 + centerOffset;
  return {
    size,
    x: fitShellPositionInBoundsH(x),
    height: fitShellPositionInBoundsV(height),
  };
}
function launchShellFromConfig(event) {
  const shell = new Shell(shellFromConfig(shellSizeSelector()));
  const w = stageW;
  const h = stageH;
  shell.launch(
    event ? event.x / w : getRandomShellPositionH(),
    event ? 1 - event.y / h : getRandomShellPositionV()
  );
}

function seqRandomShell() {
  const size = getRandomShellSize();
  const shell = new Shell(shellFromConfig(size.size));
  shell.launch(size.x, size.height);
  let extraDelay = shell.starLife;
  if (shell.fallingLeaves) extraDelay = 4600;
  return 900 + Math.random() * 600 + extraDelay;
}
function seqRandomFastShell() {
  const shellType = randomFastShell();
  const size = getRandomShellSize();
  const shell = new Shell(shellType(size.size));
  shell.launch(size.x, size.height);
  return 900 + Math.random() * 600 + shell.starLife;
}
function seqTwoRandom() {
  const size1 = getRandomShellSize();
  const size2 = getRandomShellSize();
  const shell1 = new Shell(shellFromConfig(size1.size));
  const shell2 = new Shell(shellFromConfig(size2.size));
  const leftOffset = Math.random() * 0.2 - 0.1;
  const rightOffset = Math.random() * 0.2 - 0.1;
  shell1.launch(0.3 + leftOffset, size1.height);
  setTimeout(() => {
    shell2.launch(0.7 + rightOffset, size2.height);
  }, 100);
  let extraDelay = Math.max(shell1.starLife, shell2.starLife);
  if (shell1.fallingLeaves || shell2.fallingLeaves) extraDelay = 4600;
  return 900 + Math.random() * 600 + extraDelay;
}
function seqTriple() {
  const shellType = randomFastShell();
  const baseSize = shellSizeSelector();
  const smallSize = Math.max(0, baseSize - 1.25);
  const offset = Math.random() * 0.08 - 0.04;
  const shell1 = new Shell(shellType(baseSize));
  shell1.launch(0.5 + offset, 0.7);
  const leftDelay = 1000 + Math.random() * 400;
  const rightDelay = 1000 + Math.random() * 400;
  setTimeout(() => {
    const offset = Math.random() * 0.08 - 0.04;
    const shell2 = new Shell(shellType(smallSize));
    shell2.launch(0.2 + offset, 0.1);
  }, leftDelay);
  setTimeout(() => {
    const offset = Math.random() * 0.08 - 0.04;
    const shell3 = new Shell(shellType(smallSize));
    shell3.launch(0.8 + offset, 0.1);
  }, rightDelay);
  return 4000;
}
function seqPyramid() {
  const barrageCountHalf = IS_DESKTOP ? 7 : 4;
  const largeSize = shellSizeSelector();
  const smallSize = Math.max(0, largeSize - 3);
  const randomMainShell = Math.random() < 0.78 ? crysanthemumShell : ringShell;
  const randomSpecialShell = randomShell;
  function launchShell(x, useSpecial) {
    const isRandom = shellNameSelector() === "Random";
    let shellType = isRandom
      ? useSpecial
        ? randomSpecialShell
        : randomMainShell
      : shellTypes[shellNameSelector()];
    const shell = new Shell(shellType(useSpecial ? largeSize : smallSize));
    const height = x <= 0.5 ? x / 0.5 : (1 - x) / 0.5;
    shell.launch(x, useSpecial ? 0.75 : height * 0.42);
  }
  let count = 0;
  let delay = 0;
  while (count <= barrageCountHalf) {
    if (count === barrageCountHalf) {
      setTimeout(() => {
        launchShell(0.5, true);
      }, delay);
    } else {
      const offset = (count / barrageCountHalf) * 0.5;
      const delayOffset = Math.random() * 30 + 30;
      setTimeout(() => {
        launchShell(offset, false);
      }, delay);
      setTimeout(() => {
        launchShell(1 - offset, false);
      }, delay + delayOffset);
    }
    count++;
    delay += 200;
  }
  return 3400 + barrageCountHalf * 250;
}
function seqSmallBarrage() {
  seqSmallBarrage.lastCalled = Date.now();
  const barrageCount = IS_DESKTOP ? 11 : 5;
  const specialIndex = IS_DESKTOP ? 3 : 1;
  const shellSize = Math.max(0, shellSizeSelector() - 2);
  const randomMainShell = Math.random() < 0.78 ? crysanthemumShell : ringShell;
  const randomSpecialShell = randomFastShell();
  function launchShell(x, useSpecial) {
    const isRandom = shellNameSelector() === "Random";
    let shellType = isRandom
      ? useSpecial
        ? randomSpecialShell
        : randomMainShell
      : shellTypes[shellNameSelector()];
    const shell = new Shell(shellType(shellSize));
    const height = (Math.cos(x * 5 * Math.PI + PI_HALF) + 1) / 2;
    shell.launch(x, height * 0.75);
  }
  let count = 0;
  let delay = 0;
  while (count < barrageCount) {
    if (count === 0) {
      launchShell(0.5, false);
      count += 1;
    } else {
      const offset = (count + 1) / barrageCount / 2;
      const delayOffset = Math.random() * 30 + 30;
      const useSpecial = count === specialIndex;
      setTimeout(() => {
        launchShell(0.5 + offset, useSpecial);
      }, delay);
      setTimeout(() => {
        launchShell(0.5 - offset, useSpecial);
      }, delay + delayOffset);
      count += 2;
    }
    delay += 200;
  }
  return 3400 + barrageCount * 120;
}
seqSmallBarrage.cooldown = 15000;
seqSmallBarrage.lastCalled = Date.now();
let isFirstSeq = true;
const finaleCount = 32;
let currentFinaleCount = 0;
function startSequence() {
  if (isFirstSeq) {
    isFirstSeq = false;
    if (IS_HEADER) return seqTwoRandom();
    const shell = new Shell(crysanthemumShell(shellSizeSelector()));
    shell.launch(0.5, 0.5);
    return 2400;
  }
  if (finaleSelector()) {
    seqRandomFastShell();
    if (currentFinaleCount < finaleCount) {
      currentFinaleCount++;
      return 170;
    } else {
      currentFinaleCount = 0;
      return 6000;
    }
  }
  const rand = Math.random();
  if (
    rand < 0.08 &&
    Date.now() - seqSmallBarrage.lastCalled > seqSmallBarrage.cooldown
  )
    return seqSmallBarrage();
  if (rand < 0.1) return seqPyramid();
  if (rand < 0.6 && !IS_HEADER) return seqRandomShell();
  else if (rand < 0.8) return seqTwoRandom();
  else if (rand < 1) return seqTriple();
}

// --- CONTROLS ---
let activePointerCount = 0;
let isUpdatingSpeed = false;
function handlePointerStart(e) {
  activePointerCount++;
  const x = e.global.x;
  const y = e.global.y;
  if (!isRunning()) return;
  if (updateSpeedFromEvent(x, y)) isUpdatingSpeed = true;
  else launchShellFromConfig({ x, y });
}
function handlePointerEnd(e) {
  activePointerCount--;
  isUpdatingSpeed = false;
}
function handlePointerMove(e) {
  if (!isRunning()) return;
  if (isUpdatingSpeed) updateSpeedFromEvent(e.global.x, e.global.y);
}
function handleKeydown(e) {
  if (e.keyCode === 80) togglePause();
  else if (e.keyCode === 79) toggleMenu();
  else if (e.keyCode === 27) toggleMenu(false);
}
function updateSpeedFromEvent(x, y) {
  if (isUpdatingSpeed || y >= stageH - 44) {
    const edge = 16;
    const newSpeed = (x - edge) / (stageW - edge * 2);
    simSpeed = Math.min(Math.max(newSpeed, 0), 1);
    speedBarOpacity = 1;
    return true;
  }
  return false;
}

// --- SOUND ---
const soundManager = {
  baseURL: "./audio/",
  ctx: new (window.AudioContext || window.webkitAudioContext)(),
  sources: {
    lift: {
      volume: 1,
      playbackRateMin: 0.85,
      playbackRateMax: 0.95,
      fileNames: ["lift1.mp3", "lift2.mp3", "lift3.mp3"],
    },
    burst: {
      volume: 1,
      playbackRateMin: 0.8,
      playbackRateMax: 0.9,
      fileNames: ["burst1.mp3", "burst2.mp3"],
    },
    burstSmall: {
      volume: 0.25,
      playbackRateMin: 0.8,
      playbackRateMax: 1,
      fileNames: ["burst-sm-1.mp3", "burst-sm-2.mp3"],
    },
    crackle: {
      volume: 0.2,
      playbackRateMin: 1,
      playbackRateMax: 1,
      fileNames: ["crackle1.mp3"],
    },
    crackleSmall: {
      volume: 0.3,
      playbackRateMin: 1,
      playbackRateMax: 1,
      fileNames: ["crackle-sm-1.mp3"],
    },
  },
  async preload() {
    const allFilePromises = [];
    const types = Object.keys(this.sources);
    types.forEach((type) => {
      const source = this.sources[type];
      source.buffers = [];
      const filePromises = source.fileNames.map((fileName) => {
        return fetch(this.baseURL + fileName)
          .then((r) => {
            if (r.ok) return r.arrayBuffer();
            else throw new Error("404");
          })
          .then((data) => this.ctx.decodeAudioData(data))
          .then((buffer) => {
            source.buffers.push(buffer);
          })
          .catch((e) =>
            console.warn(`Sound ${fileName} missing or CORS blocked.`, e)
          );
      });
      allFilePromises.push(...filePromises);
    });
    await Promise.all(allFilePromises);
  },
  pauseAll() {
    this.ctx.suspend();
  },
  resumeAll() {
    this.playSound("lift", 0);
    setTimeout(() => this.ctx.resume(), 250);
  },
  _lastSmallBurstTime: 0,
  playSound(type, scale = 1) {
    scale = MyMath.clamp(scale, 0, 1);
    if (!canPlaySoundSelector() || simSpeed < 0.95) return;
    if (type === "burstSmall") {
      const now = Date.now();
      if (now - this._lastSmallBurstTime < 20) return;
      this._lastSmallBurstTime = now;
    }
    const source = this.sources[type];
    if (!source || !source.buffers || source.buffers.length === 0) return;
    const initialVolume = source.volume;
    const initialPlaybackRate = MyMath.random(
      source.playbackRateMin,
      source.playbackRateMax
    );
    const scaledVolume = initialVolume * scale;
    const scaledPlaybackRate = initialPlaybackRate * (2 - scale);
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = scaledVolume;
    const buffer = MyMath.randomChoice(source.buffers);
    const bufferSource = this.ctx.createBufferSource();
    bufferSource.playbackRate.value = scaledPlaybackRate;
    bufferSource.buffer = buffer;
    bufferSource.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    bufferSource.start(0);
  },
};

// --- UI HELPERS ---
const appNodes = {
  controls: ".controls",
  menu: ".menu",
  menuInnerWrap: ".menu__inner-wrap",
  pauseBtn: ".pause-btn",
  pauseBtnSVG: ".pause-btn use",
  soundBtn: ".sound-btn",
  soundBtnSVG: ".sound-btn use",
  shellType: ".shell-type",
  shellSize: ".shell-size",
  quality: ".quality-ui",
  skyLighting: ".sky-lighting",
  scaleFactor: ".scaleFactor",
  wordShell: ".word-shell",
  autoLaunch: ".auto-launch",
  finaleMode: ".finale-mode",
  hideControls: ".hide-controls",
  fullscreen: ".fullscreen",
  longExposure: ".long-exposure",
};
Object.keys(appNodes).forEach(
  (k) => (appNodes[k] = document.querySelector(appNodes[k]))
);

function initUI() {
  // Populate Selects
  shellNames.forEach(
    (opt) =>
      (appNodes.shellType.innerHTML += `<option value="${opt}">${opt}</option>`)
  );
  ['3"', '4"', '6"', '8"', '12"', '16"'].forEach(
    (opt, i) =>
      (appNodes.shellSize.innerHTML += `<option value="${i}">${opt}</option>`)
  );

  // Japanese options
  const qOpts = [
    { l: "低", v: QUALITY_LOW },
    { l: "中", v: QUALITY_NORMAL },
    { l: "高", v: QUALITY_HIGH },
  ];
  qOpts.forEach(
    (o) =>
      (appNodes.quality.innerHTML += `<option value="${o.v}">${o.l}</option>`)
  );

  const sOpts = [
    { l: "なし", v: SKY_LIGHT_NONE },
    { l: "暗い", v: SKY_LIGHT_DIM },
    { l: "普通", v: SKY_LIGHT_NORMAL },
  ];
  sOpts.forEach(
    (o) =>
      (appNodes.skyLighting.innerHTML += `<option value="${o.v}">${o.l}</option>`)
  );

  const scOpts = [0.5, 0.62, 0.75, 0.9, 1.0, 1.5, 2.0];
  scOpts.forEach(
    (v) =>
      (appNodes.scaleFactor.innerHTML += `<option value="${v.toFixed(2)}">${
        v * 100
      }%</option>`)
  );

  // Listeners
  appNodes.quality.addEventListener("input", () => updateConfig());
  appNodes.shellType.addEventListener("input", () => updateConfig());
  appNodes.shellSize.addEventListener("input", () => updateConfig());
  appNodes.wordShell.addEventListener("click", () => updateConfig());
  appNodes.autoLaunch.addEventListener("click", () => updateConfig());
  appNodes.finaleMode.addEventListener("click", () => updateConfig());
  appNodes.skyLighting.addEventListener("input", () => updateConfig());
  appNodes.longExposure.addEventListener("click", () => updateConfig());
  appNodes.hideControls.addEventListener("click", () => updateConfig());
  appNodes.fullscreen.addEventListener("click", () => toggleFullscreen());
  appNodes.scaleFactor.addEventListener("input", () => {
    updateConfig();
    handleResize();
  });

  document
    .querySelector(".pause-btn")
    .addEventListener("click", () => togglePause());
  document
    .querySelector(".sound-btn")
    .addEventListener("click", () => toggleSound());
  document
    .querySelector(".settings-btn")
    .addEventListener("click", () => toggleMenu());
  document
    .querySelector(".close-menu-btn")
    .addEventListener("click", () => toggleMenu(false));
}

function renderApp(state) {
  const pauseBtnIcon = `#icon-${state.paused ? "play" : "pause"}`;
  const soundBtnIcon = `#icon-sound-${state.soundEnabled ? "on" : "off"}`;
  appNodes.pauseBtnSVG.setAttribute("href", pauseBtnIcon);
  appNodes.soundBtnSVG.setAttribute("href", soundBtnIcon);
  appNodes.controls.classList.toggle(
    "hide",
    state.menuOpen || state.config.hideControls
  );
  appNodes.menu.classList.toggle("hide", !state.menuOpen);

  appNodes.quality.value = state.config.quality;
  appNodes.shellType.value = state.config.shell;
  appNodes.shellSize.value = state.config.size;
  appNodes.wordShell.checked = state.config.wordShell;
  appNodes.autoLaunch.checked = state.config.autoLaunch;
  appNodes.finaleMode.checked = state.config.finale;
  appNodes.skyLighting.value = state.config.skyLighting;
  appNodes.hideControls.checked = state.config.hideControls;
  appNodes.fullscreen.checked = state.fullscreen;
  appNodes.longExposure.checked = state.config.longExposure;
  appNodes.scaleFactor.value = parseFloat(state.config.scaleFactor).toFixed(2);
}

function configDidUpdate() {
  const config = store.state.config;
  quality = +config.quality;
  isLowQuality = quality === QUALITY_LOW;
  isNormalQuality = quality === QUALITY_NORMAL;
  isHighQuality = quality === QUALITY_HIGH;
  Spark.drawWidth = quality === QUALITY_HIGH ? 0.75 : 1;
}

function updateConfig() {
  store.setState({
    config: Object.assign({}, store.state.config, {
      quality: appNodes.quality.value,
      shell: appNodes.shellType.value,
      size: appNodes.shellSize.value,
      wordShell: appNodes.wordShell.checked,
      autoLaunch: appNodes.autoLaunch.checked,
      finale: appNodes.finaleMode.checked,
      skyLighting: appNodes.skyLighting.value,
      longExposure: appNodes.longExposure.checked,
      hideControls: appNodes.hideControls.checked,
      scaleFactor: parseFloat(appNodes.scaleFactor.value),
    }),
  });
  configDidUpdate();
}

function togglePause(toggle) {
  const paused = store.state.paused;
  let newValue = typeof toggle === "boolean" ? toggle : !paused;
  store.setState({ paused: newValue });
}
function toggleSound(toggle) {
  let newValue =
    typeof toggle === "boolean" ? toggle : !store.state.soundEnabled;
  store.setState({ soundEnabled: newValue });
  if (newValue) soundManager.resumeAll();
  else soundManager.pauseAll();
}
function toggleMenu(toggle) {
  store.setState({
    menuOpen: typeof toggle === "boolean" ? toggle : !store.state.menuOpen,
  });
}
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
    store.setState({ fullscreen: true });
  } else {
    document.exitFullscreen();
    store.setState({ fullscreen: false });
  }
}

// Selectors
const isRunning = () => !store.state.paused && !store.state.menuOpen;
const canPlaySoundSelector = () => isRunning() && store.state.soundEnabled;
const shellSizeSelector = () => +store.state.config.size;
const finaleSelector = () => store.state.config.finale;
const skyLightingSelector = () => +store.state.config.skyLighting;
const shellNameSelector = () => store.state.config.shell;
const scaleFactorSelector = () => store.state.config.scaleFactor;

// --- START ---
initApp();
