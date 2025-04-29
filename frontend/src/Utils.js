import { Config, translations, icons } from "./Config";
import * as monaco from "monaco-editor";

export class Utils {
  static createMonaco(container, content, type, editable) {
    let monacoOptions = {
      value: content, // Initial content
      language: type, // Language mode (yaml, json, etc.)
      theme: "vs-dark", // Use dark theme
      readOnly: !editable, // Set read-only mode if not editable
      automaticLayout: true, // Automatically resize the editor
      fontSize: 16,
      wordWrap: "on",
    };

    return monaco.editor.create(container, monacoOptions);
  }
  // Function to copy text to the clipboard
  static copy(event, text) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        const tooltip = Utils.createEl("tooltip", Utils.translate("Copied"));
        document.body.append(tooltip);
        tooltip.style.left = `${event.pageX + 30}px`;
        tooltip.style.top = `${event.pageY - 50}px`;

        setTimeout(() => {
          tooltip.remove();
        }, 1000);
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
      });
  }

  // Create a new DOM element with optional text content and tag name
  static createEl(className, textContent = "", tagName = "div") {
    const tag = document.createElement(tagName);
    tag.className = className;
    tag.textContent = textContent;
    return tag;
  }

  // Create an icon element
  static createIconEl(iconClass) {
    return Utils.createEl(`fas ${iconClass}`, "", "i");
  }

  static createInputEl(inputClass, placeholder = "", type = "text") {
    const input = Utils.createEl(inputClass, "", "input");
    input.type = type;
    input.placeholder = placeholder;
    return input;
  }

  // Create an error message element
  static createErrorMessage(message) {
    return `<div class="error-message" role="alert">
              <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
              <span>${message}</span>
            </div>`;
  }

  // Translate a key based on the current language
  static translate(key) {
    return translations[Config.lang]?.[key] || key;
  }

  // Create an action button with optional click handler
  static createActionBtn(hint, dataText, handler = null, action = "click") {
    const button = Utils.createEl(
      `action-button ${hint.toLowerCase()}-btn`,
      "",
      "button",
    );
    button.setAttribute("data-title", Utils.translate(hint));
    button.tabIndex = -1;
    button.innerHTML = `<i class="fas ${icons[hint]}"></i>`;

    if (handler) {
      button.addEventListener(action, (event) => handler(event, dataText));
    }
    return button;
  }

  // Show the loading indicator
  static showLoadingIndicator(message, tab) {
    const loadingIndicator = tab.querySelector("#loadingIndicator");

    const loadingMessage = loadingIndicator.querySelector(".loading-message");
    if (loadingMessage) {
      loadingMessage.textContent = Utils.translate(message) + "...";
    }

    loadingIndicator.style.display = "flex";
    loadingIndicator.classList.add("fade-in");
  }

  // Hide the loading indicator
  static hideLoadingIndicator(tab) {
    const loadingIndicator = tab.querySelector("#loadingIndicator");
    loadingIndicator.style.display = "none";
    loadingIndicator.classList.remove("fade-in");
  }
}
