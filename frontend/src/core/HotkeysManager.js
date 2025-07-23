// frontend/src/core/HotkeysManager.js
export class HotkeysManager {
  constructor(app) {
    this.app = app;
    this.setupEventListener();
  }

  setupEventListener() {
    document.addEventListener("keydown", (event) => {
      // Игнорируем если фокус в input/textarea
      if (this.isInputFocused()) {
        return;
      }

      // Ctrl+T - новая вкладка
      if (event.ctrlKey && event.key === "t") {
        event.preventDefault();
        this.app.tabsManager.createNewTab();
      }

      // Ctrl+W - закрыть вкладку
      if (event.ctrlKey && event.key === "w") {
        event.preventDefault();
        this.closeCurrentTab();
      }

      // Ctrl+1-9 - переключение между вкладками
      if (event.ctrlKey && event.key >= "1" && event.key <= "9") {
        event.preventDefault();
        this.switchToTab(parseInt(event.key) - 1);
      }

      // Ctrl+Tab и Ctrl+Shift+Tab - переключение вкладок
      if (event.ctrlKey && event.code === "Tab") {
        event.preventDefault();
        event.stopPropagation();

        if (event.shiftKey) {
          this.switchToPrevTab();
        } else {
          this.switchToNextTab();
        }
      }
    });
  }

  switchToTab(index) {
    const tabs = document.querySelectorAll(".tab");
    if (tabs[index]) {
      this.app.tabsManager.activateTab(tabs[index]);
    }
  }

  switchToNextTab() {
    const tabs = Array.from(document.querySelectorAll(".tab"));
    const activeTab = document.querySelector(".tab.active");
    const currentIndex = tabs.indexOf(activeTab);
    const nextIndex = (currentIndex + 1) % tabs.length;
    this.app.tabsManager.activateTab(tabs[nextIndex]);
  }

  switchToPrevTab() {
    const tabs = Array.from(document.querySelectorAll(".tab"));
    const activeTab = document.querySelector(".tab.active");
    const currentIndex = tabs.indexOf(activeTab);
    const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
    this.app.tabsManager.activateTab(tabs[prevIndex]);
  }

  isInputFocused() {
    const activeElement = document.activeElement;
    return (
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.contentEditable === "true")
    );
  }

  closeCurrentTab() {
    const activeTab = document.querySelector(".tab.active");
    if (activeTab) {
      this.app.tabsManager.closeTab(activeTab);
    }
  }
}
