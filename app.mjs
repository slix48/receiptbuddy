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

async function recognizeTextFromImage(file) {
  if (!("TextDetector" in window)) {
    return {
      text: "",
      supported: false,
    };
  }

  const detector = new window.TextDetector();
  const bitmap = await createImageBitmap(file);
  const detections = await detector.detect(bitmap);
  bitmap.close?.();

  return {
    text: detections.map((item) => item.rawValue || "").join("\n"),
    supported: true,
  };
}

function initApp() {
  const receiptInput = document.querySelector("#receiptInput");
  const photoButton = document.querySelector("#photoButton");
  const receiptPreview = document.querySelector("#receiptPreview");
  const photoFrame = document.querySelector(".photo-frame");
  const scanStatus = document.querySelector("#scanStatus");
  const candidateArea = document.querySelector("#candidateArea");
  const candidateList = document.querySelector("#candidateList");
  const candidateTemplate = document.querySelector("#candidateTemplate");
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

  photoButton.addEventListener("click", () => {
    receiptInput.click();
  });

  receiptInput.addEventListener("change", async () => {
    const [file] = receiptInput.files || [];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setStatus("That file is not a photo. Choose an image of the receipt.", true);
      return;
    }

    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
    state.photoUrl = URL.createObjectURL(file);
    receiptPreview.src = state.photoUrl;
    photoFrame.classList.add("has-photo");
    setStatus("Reading the receipt photo.");
    renderCandidates([]);

    try {
      const recognition = await recognizeTextFromImage(file);
      if (!recognition.supported) {
        setStatus("This browser cannot read receipt text automatically. Enter the check total below.", true);
        return;
      }

      const parsed = parseReceiptText(recognition.text);
      renderCandidates(parsed.candidates);

      if (parsed.total > 0) {
        setTotal(parsed.total);
        setStatus(`${formatMoney(parsed.total)} found. Confirm the total before paying.`);
      } else {
        setStatus("No total was found. Enter the check total below.", true);
      }
    } catch (error) {
      setStatus("The photo could not be scanned. Enter the check total below.", true);
    }
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
    localStorage.setItem("checkmate-large-text", enabled ? "true" : "false");
  });

  if (localStorage.getItem("checkmate-large-text") === "true") {
    document.body.classList.add("large-text");
    largeTextButton.setAttribute("aria-pressed", "true");
  }

  updateMath();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initApp();
}
