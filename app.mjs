const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const state = {
  total: 42,
  tipPercent: 18,
  split: 1,
  roundUp: false,
  photoUrl: "",
  ocrWorker: null,
  lightOn: false,
};

const negativeReceiptWords = /\b(change|cash|paid|payment|visa|mastercard|amex|discover|card|auth|approval|tip|gratuity|server|table)\b/i;
const strongTotalWords = /\b(grand\s+total|amount\s+due|balance\s+due|total\s+due|total)\b/i;
const weakTotalWords = /\b(subtotal|sub\s+total|pre[-\s]?tax|food|sales)\b/i;

export function parseMoney(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return 0;
  }

  const normalized = String(value)
    .replace(/[^\d.,-]/g, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(",", ".");

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return moneyFormatter.format(Math.max(0, safeValue));
}

export function calculateTip(total, tipPercent, split = 1, roundUp = false) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeTipPercent = Math.max(0, Number(tipPercent) || 0);
  const safeSplit = Math.max(1, Math.round(Number(split) || 1));
  let tip = safeTotal * (safeTipPercent / 100);
  let grandTotal = safeTotal + tip;

  if (roundUp && grandTotal > 0) {
    grandTotal = Math.ceil(grandTotal);
    tip = grandTotal - safeTotal;
  }

  return {
    tip,
    grandTotal,
    perPerson: grandTotal / safeSplit,
  };
}

export function parseReceiptText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = [];
  const amountPattern = /(?:^|[^\d])(\$?\s*\d{1,4}(?:[,.]\d{3})*(?:[,.]\d{2}))(?!\d)/g;

  lines.forEach((line, index) => {
    const matches = [...line.matchAll(amountPattern)];
    matches.forEach((match) => {
      const amount = parseMoney(match[1]);
      if (amount <= 0 || amount > 100000) {
        return;
      }

      let score = 0;
      if (strongTotalWords.test(line)) score += 8;
      if (weakTotalWords.test(line)) score += 3;
      if (negativeReceiptWords.test(line)) score -= 6;
      if (index >= lines.length - 5) score += 2;
      if (amount >= 5) score += 1;

      candidates.push({
        amount,
        label: line.replace(/\s+/g, " ").slice(0, 64),
        score,
        index,
      });
    });
  });

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.amount.toFixed(2);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }

  unique.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.index !== a.index) return b.index - a.index;
    return b.amount - a.amount;
  });

  return {
    total: unique[0]?.amount ?? 0,
    candidates: unique.slice(0, 6),
    text: lines.join("\n"),
  };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.Tesseract) resolve();
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

async function getOcrWorker(onProgress) {
  if (state.ocrWorker) return state.ocrWorker;

  await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js");
  state.ocrWorker = await window.Tesseract.createWorker("eng", 1, {
    logger: (event) => {
      if (event.status === "recognizing text" && typeof event.progress === "number") {
        onProgress?.(Math.round(event.progress * 100));
      }
    },
  });

  return state.ocrWorker;
}

async function recognizeWithTesseract(file, onProgress) {
  try {
    const worker = await getOcrWorker(onProgress);
    const result = await worker.recognize(file);
    return result?.data?.text?.trim() || "";
  } catch {
    return "";
  }
}

async function recognizeWithTextDetector(file) {
  if (!("TextDetector" in window)) {
    return "";
  }

  const detector = new window.TextDetector();
  const bitmap = await createImageBitmap(file);
  const detections = await detector.detect(bitmap);
  bitmap.close?.();
  return detections.map((item) => item.rawValue || "").join("\n").trim();
}

async function recognizeTextFromImage(file, onProgress) {
  const tesseractText = await recognizeWithTesseract(file, onProgress);
  if (tesseractText) {
    return {
      text: tesseractText,
      supported: true,
      engine: "OCR",
    };
  }

  const browserText = await recognizeWithTextDetector(file);
  if (browserText) {
    return {
      text: browserText,
      supported: true,
      engine: "browser text reader",
    };
  }

  return {
    text: "",
    supported: false,
    engine: "",
  };
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function initApp() {
  const cameraInput = document.querySelector("#cameraInput");
  const uploadInput = document.querySelector("#uploadInput");
  const cameraButton = document.querySelector("#cameraButton");
  const uploadButton = document.querySelector("#uploadButton");
  const lightButton = document.querySelector("#lightButton");
  const lightOverlay = document.querySelector("#lightOverlay");
  const closeLightButton = document.querySelector("#closeLightButton");
  const lightSlider = document.querySelector("#lightSlider");
  const receiptPreview = document.querySelector("#receiptPreview");
  const photoFrame = document.querySelector(".photo-frame");
  const scanStatus = document.querySelector("#scanStatus");
  const candidateArea = document.querySelector("#candidateArea");
  const candidateList = document.querySelector("#candidateList");
  const candidateTemplate = document.querySelector("#candidateTemplate");
  const textReview = document.querySelector("#textReview");
  const recognizedText = document.querySelector("#recognizedText");
  const rescanTextButton = document.querySelector("#rescanTextButton");
  const checkTotal = document.querySelector("#checkTotal");
  const customTip = document.querySelector("#customTip");
  const tipButtons = document.querySelector("#tipButtons");
  const splitMinus = document.querySelector("#splitMinus");
  const splitPlus = document.querySelector("#splitPlus");
  const splitCount = document.querySelector("#splitCount");
  const roundTotal = document.querySelector("#roundTotal");
  const tipAmount = document.querySelector("#tipAmount");
  const grandTotal = document.querySelector("#grandTotal");
  const perPerson = document.querySelector("#perPerson");
  const resetButton = document.querySelector("#resetButton");
  const readButton = document.querySelector("#readButton");
  const copyButton = document.querySelector("#copyButton");
  const largeTextButton = document.querySelector("#largeTextButton");

  const setStatus = (message, isError = false) => {
    scanStatus.textContent = message;
    scanStatus.classList.toggle("is-error", isError);
  };

  const updateMath = () => {
    state.total = parseMoney(checkTotal.value);
    state.roundUp = roundTotal.checked;
    const result = calculateTip(state.total, state.tipPercent, state.split, state.roundUp);

    tipAmount.textContent = formatMoney(result.tip);
    grandTotal.textContent = formatMoney(result.grandTotal);
    perPerson.textContent = formatMoney(result.perPerson);
    splitCount.textContent = String(state.split);
  };

  const setTotal = (amount) => {
    checkTotal.value = amount ? amount.toFixed(2) : "";
    updateMath();
    checkTotal.focus();
    checkTotal.select();
  };

  const renderCandidates = (candidates) => {
    candidateList.textContent = "";
    candidateArea.hidden = candidates.length === 0;

    candidates.forEach((candidate, index) => {
      const button = candidateTemplate.content.firstElementChild.cloneNode(true);
      button.querySelector(".candidate-amount").textContent = formatMoney(candidate.amount);
      button.querySelector(".candidate-label").textContent = index === 0 ? "Best match" : candidate.label;
      button.addEventListener("click", () => {
        setTotal(candidate.amount);
        setStatus(`${formatMoney(candidate.amount)} selected as the check total.`);
      });
      candidateList.append(button);
    });
  };

  const useRecognizedText = (text, engine = "OCR") => {
    recognizedText.value = text;
    textReview.hidden = text.trim().length === 0;
    const parsed = parseReceiptText(text);
    renderCandidates(parsed.candidates);

    if (parsed.total > 0) {
      setTotal(parsed.total);
      setStatus(`${formatMoney(parsed.total)} found with ${engine}. Confirm the total before paying.`);
    } else if (text.trim()) {
      setStatus("Text was read, but no total was found. Check the text or enter the total below.", true);
    } else {
      setStatus("No receipt text was found. Enter the check total below.", true);
    }
  };

  const handleReceiptFile = async (file, sourceLabel) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setStatus("That file is not a photo. Choose an image of the receipt.", true);
      return;
    }

    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
    state.photoUrl = URL.createObjectURL(file);
    receiptPreview.src = state.photoUrl;
    photoFrame.classList.add("has-photo");
    setStatus(`${sourceLabel} selected. Reading receipt text.`);
    renderCandidates([]);
    recognizedText.value = "";
    textReview.hidden = true;

    try {
      const recognition = await recognizeTextFromImage(file, (percent) => {
        setStatus(`Reading receipt text: ${percent}%`);
      });

      if (!recognition.supported) {
        setStatus("Receipt text could not be read on this device. Enter the check total below.", true);
        return;
      }

      useRecognizedText(recognition.text, recognition.engine);
    } catch {
      setStatus("The photo could not be scanned. Enter the check total below.", true);
    }
  };

  const setLightMode = (enabled) => {
    state.lightOn = enabled;
    document.body.classList.toggle("light-mode", enabled);
    lightOverlay.hidden = !enabled;
    lightButton.setAttribute("aria-pressed", String(enabled));
    lightButton.textContent = enabled ? "Light On" : "Dim Light";
  };

  const setLightStrength = () => {
    const level = Math.min(35, Math.max(12, Number(lightSlider.value) || 22));
    lightOverlay.style.setProperty("--light-alpha", String(level / 100));
  };

  cameraButton.addEventListener("click", () => {
    cameraInput.click();
  });

  uploadButton.addEventListener("click", () => {
    uploadInput.click();
  });

  lightButton.addEventListener("click", () => {
    setLightMode(!state.lightOn);
  });

  closeLightButton.addEventListener("click", () => {
    setLightMode(false);
  });

  lightSlider.addEventListener("input", setLightStrength);
  setLightStrength();

  cameraInput.addEventListener("change", async () => {
    await handleReceiptFile(cameraInput.files?.[0], "Camera photo");
    cameraInput.value = "";
  });

  uploadInput.addEventListener("change", async () => {
    await handleReceiptFile(uploadInput.files?.[0], "Uploaded photo");
    uploadInput.value = "";
  });

  rescanTextButton.addEventListener("click", () => {
    useRecognizedText(recognizedText.value, "edited receipt text");
  });

  checkTotal.addEventListener("input", updateMath);
  roundTotal.addEventListener("change", updateMath);

  tipButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tip]");
    if (!button) return;

    state.tipPercent = Number(button.dataset.tip);
    customTip.value = "";
    tipButtons.querySelectorAll(".tip-button").forEach((tipButton) => {
      const selected = tipButton === button;
      tipButton.classList.toggle("is-selected", selected);
      tipButton.setAttribute("aria-pressed", String(selected));
    });
    updateMath();
  });

  customTip.addEventListener("input", () => {
    const value = Number(customTip.value);
    if (Number.isFinite(value) && value >= 0) {
      state.tipPercent = value;
      tipButtons.querySelectorAll(".tip-button").forEach((tipButton) => {
        tipButton.classList.remove("is-selected");
        tipButton.setAttribute("aria-pressed", "false");
      });
      updateMath();
    }
  });

  splitMinus.addEventListener("click", () => {
    state.split = Math.max(1, state.split - 1);
    updateMath();
  });

  splitPlus.addEventListener("click", () => {
    state.split = Math.min(20, state.split + 1);
    updateMath();
  });

  resetButton.addEventListener("click", () => {
    checkTotal.value = "0.00";
    customTip.value = "";
    state.tipPercent = 18;
    state.split = 1;
    roundTotal.checked = false;
    tipButtons.querySelectorAll(".tip-button").forEach((tipButton) => {
      const selected = tipButton.dataset.tip === "18";
      tipButton.classList.toggle("is-selected", selected);
      tipButton.setAttribute("aria-pressed", String(selected));
    });
    renderCandidates([]);
    recognizedText.value = "";
    textReview.hidden = true;
    setStatus("Calculator reset.");
    updateMath();
  });

  readButton.addEventListener("click", () => {
    const result = calculateTip(state.total, state.tipPercent, state.split, state.roundUp);
    const message = `Tip ${formatMoney(result.tip)}. Total ${formatMoney(result.grandTotal)}. Each person ${formatMoney(result.perPerson)}.`;
    setStatus(message);

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
    }
  });

  copyButton.addEventListener("click", async () => {
    const result = calculateTip(state.total, state.tipPercent, state.split, state.roundUp);
    const summary = `Check: ${formatMoney(state.total)}\nTip: ${formatMoney(result.tip)}\nTotal: ${formatMoney(result.grandTotal)}\nEach: ${formatMoney(result.perPerson)}`;

    try {
      await navigator.clipboard.writeText(summary);
      setStatus("Tip total copied.");
    } catch {
      setStatus(summary);
    }
  });

  largeTextButton.addEventListener("click", () => {
    const enabled = !document.body.classList.contains("large-text");
    document.body.classList.toggle("large-text", enabled);
    largeTextButton.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("receiptbuddy-large-text", enabled ? "true" : "false");
  });

  if (localStorage.getItem("receiptbuddy-large-text") === "true") {
    document.body.classList.add("large-text");
    largeTextButton.setAttribute("aria-pressed", "true");
  }

  updateMath();
  registerServiceWorker();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initApp();
}