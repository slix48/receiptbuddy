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
  torchStream: null,
  torchTrack: null,
};

const finalTotalWords = /\b(grand\s+total|amount\s+due|balance\s+due|total\s+due|final\s+total|total|amount)\b/i;
const nonFinalTotalWords = /\b(subtotal|sub\s+total|pre[-\s]?tax|tax|sales\s+tax|tip|gratuity|change|cash|paid|payment|tendered|received|visa|mastercard|amex|discover|debit|credit|card|auth|approval|server|table)\b/i;

export function parseMoney(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return 0;
  }

  let normalized = String(value)
    .trim()
    .replace(/[^\d.,\s-]/g, "")
    .replace(/\s+/g, " ");

  const spaceDecimal = normalized.match(/^(-?\d{1,3}(?: \d{3})*|-?\d+) (\d{1,2})$/);
  if (spaceDecimal) {
    normalized = `${spaceDecimal[1].replaceAll(" ", "")}.${spaceDecimal[2].padEnd(2, "0")}`;
  } else {
    normalized = normalized.replace(/\s/g, "");
    const lastDot = normalized.lastIndexOf(".");
    const lastComma = normalized.lastIndexOf(",");
    const decimalSeparator = lastDot > lastComma ? "." : ",";

    if (lastDot !== -1 && lastComma !== -1) {
      const thousandsSeparator = decimalSeparator === "." ? "," : ".";
      normalized = normalized
        .replaceAll(thousandsSeparator, "")
        .replace(decimalSeparator, ".");
    } else if (decimalSeparator === "," && /,\d{1,2}$/.test(normalized)) {
      normalized = normalized.replace(",", ".");
    } else {
      normalized = normalized.replace(/,(?=\d{3}\b)/g, "");
    }
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return moneyFormatter.format(Math.max(0, safeValue));
}

export function validateMoneyInput(value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return {
      isValid: false,
      amount: 0,
      message: "Enter the check total.",
    };
  }

  if (!/^\$?\s*-?[\d][\d,.\s]*$/.test(text)) {
    return {
      isValid: false,
      amount: 0,
      message: "Use numbers only, like 42.50.",
    };
  }

  const amount = parseMoney(text);
  if (amount < 0) {
    return {
      isValid: false,
      amount: 0,
      message: "Total cannot be negative.",
    };
  }

  if (amount > 100000) {
    return {
      isValid: false,
      amount: 0,
      message: "Total is too large.",
    };
  }

  return {
    isValid: true,
    amount,
    message: "Confirm before paying.",
  };
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

export function validateReceiptImageFile(file) {
  if (!file) {
    return {
      isValid: false,
      message: "Choose a receipt photo.",
    };
  }

  if (!String(file.type || "").startsWith("image/")) {
    return {
      isValid: false,
      message: "That file is not a photo. Choose an image of the receipt.",
    };
  }

  return {
    isValid: true,
    message: "",
  };
}

export function parseReceiptText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = [];
  const amountPattern = /(?:^|[^\d])(\$?\s*\d{1,5}(?:(?:[,\s]\d{3})+)?(?:[,.]\d{1,2}|\s+\d{2}))(?!\d)/g;
  const wholeDollarPattern = /(?:^|[^\d.,])(\$?\s*\d{1,5})(?![\d.,])/g;

  lines.forEach((line, index) => {
    const isNonFinal = nonFinalTotalWords.test(line);
    const isFinalTotal = finalTotalWords.test(line) && !isNonFinal;
    const matches = [...line.matchAll(amountPattern)];

    if (isFinalTotal && matches.length === 0) {
      matches.push(...line.matchAll(wholeDollarPattern));
    }

    matches.forEach((match) => {
      const amount = Number(parseMoney(match[1]).toFixed(2));
      if (amount <= 0 || amount > 100000) return;

      let score = 0;
      if (isFinalTotal) score += 100;
      if (isNonFinal) score -= 100;
      if (index >= lines.length - 6) score += 6;
      if (amount >= 5) score += 1;

      candidates.push({
        amount,
        label: line.replace(/\s+/g, " ").slice(0, 64),
        score,
        index,
        isFinalTotal,
        isNonFinal,
      });
    });
  });

  const sourceCandidates = candidates.some((candidate) => candidate.isFinalTotal)
    ? candidates.filter((candidate) => candidate.isFinalTotal)
    : candidates.filter((candidate) => !candidate.isNonFinal);

  const unique = [];
  const seen = new Set();
  for (const candidate of sourceCandidates) {
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
    candidates: unique.slice(0, 1),
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
  if (!("TextDetector" in window)) return "";

  const detector = new window.TextDetector();
  const bitmap = await createImageBitmap(file);
  const detections = await detector.detect(bitmap);
  bitmap.close?.();
  return detections.map((item) => item.rawValue || "").join("\n").trim();
}

async function recognizeTextFromImage(file, onProgress) {
  const tesseractText = await recognizeWithTesseract(file, onProgress);
  if (tesseractText) {
    return { text: tesseractText, supported: true, engine: "OCR" };
  }

  const browserText = await recognizeWithTextDetector(file);
  if (browserText) {
    return { text: browserText, supported: true, engine: "browser text reader" };
  }

  return { text: "", supported: false, engine: "" };
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js?v=6").catch(() => {});
  }
}

function initApp() {
  const cameraInput = document.querySelector("#cameraInput");
  const uploadInput = document.querySelector("#uploadInput");
  const cameraButton = document.querySelector("#cameraButton");
  const uploadButton = document.querySelector("#uploadButton");
  const lightButton = document.querySelector("#lightButton");
  const receiptPreview = document.querySelector("#receiptPreview");
  const photoFrame = document.querySelector(".photo-frame");
  const scanStatus = document.querySelector("#scanStatus");
  const checkTotal = document.querySelector("#checkTotal");
  const totalHelp = document.querySelector("#totalHelp");
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
  const appVersion = document.querySelector("#appVersion");

  const setStatus = (message, isError = false) => {
    scanStatus.textContent = message;
    scanStatus.classList.toggle("is-error", isError);
  };

  const updateMath = () => {
    const totalValidation = validateMoneyInput(checkTotal.value);
    state.total = totalValidation.isValid ? totalValidation.amount : 0;
    state.roundUp = roundTotal.checked;
    const result = calculateTip(state.total, state.tipPercent, state.split, state.roundUp);

    checkTotal.setAttribute("aria-invalid", String(!totalValidation.isValid));
    totalHelp.textContent = totalValidation.message;
    totalHelp.classList.toggle("is-error", !totalValidation.isValid);
    readButton.disabled = !totalValidation.isValid;
    copyButton.disabled = !totalValidation.isValid;
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

  const useRecognizedText = (text) => {
    const parsed = parseReceiptText(text);

    if (parsed.total > 0) {
      setTotal(parsed.total);
      setStatus(`Actual total: ${formatMoney(parsed.total)}.`);
    } else if (text.trim()) {
      setStatus("No Total or Amount line was found. Enter the check total below.", true);
    } else {
      setStatus("No receipt text was found. Enter the check total below.", true);
    }
  };

  const handleReceiptFile = async (file, sourceLabel) => {
    if (!file) return;

    const fileValidation = validateReceiptImageFile(file);
    if (!fileValidation.isValid) {
      setStatus(fileValidation.message, true);
      return;
    }

    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
    state.photoUrl = URL.createObjectURL(file);
    receiptPreview.src = state.photoUrl;
    photoFrame.classList.add("has-photo");
    setStatus(`${sourceLabel} selected. Reading receipt text.`);

    try {
      const recognition = await recognizeTextFromImage(file, (percent) => {
        setStatus(`Reading receipt text: ${percent}%`);
      });

      if (!recognition.supported) {
        setStatus("Receipt text could not be read on this device. Enter the check total below.", true);
        return;
      }

      useRecognizedText(recognition.text);
    } catch {
      setStatus("The photo could not be scanned. Enter the check total below.", true);
    }
  };

  const stopTorch = async () => {
    if (state.torchTrack) {
      try {
        await state.torchTrack.applyConstraints({ advanced: [{ torch: false }] });
      } catch {}
      state.torchTrack.stop();
    }

    if (state.torchStream) {
      state.torchStream.getTracks().forEach((track) => track.stop());
    }

    state.torchTrack = null;
    state.torchStream = null;
    state.lightOn = false;
    lightButton.setAttribute("aria-pressed", "false");
    lightButton.textContent = "Flashlight";
  };

  const startTorch = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Phone flashlight is not available in this browser.", true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      const [track] = stream.getVideoTracks();
      const capabilities = track.getCapabilities?.() || {};

      if (!capabilities.torch) {
        stream.getTracks().forEach((item) => item.stop());
        setStatus("Phone flashlight is not available on this device/browser.", true);
        return;
      }

      await track.applyConstraints({ advanced: [{ torch: true }] });
      state.torchStream = stream;
      state.torchTrack = track;
      state.lightOn = true;
      lightButton.setAttribute("aria-pressed", "true");
      lightButton.textContent = "Flashlight On";
      setStatus("Phone flashlight on.");
    } catch {
      setStatus("Phone flashlight could not be turned on. Camera permission may be needed.", true);
    }
  };

  const toggleTorch = async () => {
    if (state.lightOn) {
      await stopTorch();
      setStatus("Phone flashlight off.");
    } else {
      await startTorch();
    }
  };

  cameraButton.addEventListener("click", () => cameraInput.click());
  uploadButton.addEventListener("click", () => uploadInput.click());
  lightButton.addEventListener("click", toggleTorch);
  window.addEventListener("pagehide", stopTorch);

  cameraInput.addEventListener("change", async () => {
    await handleReceiptFile(cameraInput.files?.[0], "Camera photo");
    cameraInput.value = "";
  });

  uploadInput.addEventListener("change", async () => {
    await handleReceiptFile(uploadInput.files?.[0], "Uploaded photo");
    uploadInput.value = "";
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

  if (appVersion) appVersion.textContent = "v6";
  updateMath();
  registerServiceWorker();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initApp();
}
