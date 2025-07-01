import { Utils } from "./Utils.js";

export class TabsManager {
  constructor(app) {
    this.app = app;
    this.tabStates = {};
    this.tabs = [];
    this.tabIdCounter = 0;
    this.template = document.getElementsByTagName("template")[0];
    this.setupTabsSystem();
    this.createNewTab(); // default tab
  }

  setupTabsSystem() {
    const tabsContainer = document.querySelector(".tabs-container");
    const newTabBtn = document.querySelector(".new-tab-btn");

    // Set up event listener for the new tab button
    newTabBtn.addEventListener("click", () => {
      this.createNewTab();
    });

    // Set up event delegation for tab close buttons
    tabsContainer.addEventListener("click", (event) => {
      if (event.target.classList.contains("tab-close-btn")) {
        const tab = event.target.parentElement;
        this.closeTab(tab);
      } else if (event.target.closest(".tab")) {
        const tab = event.target.closest(".tab");
        this.activateTab(tab);
      }
    });
  }

  createTabContent() {
    const tab = this.template.content
      .cloneNode(true)
      .querySelector(".tab-content");
    this.tabs.push(tab);

    // Set the ID to the current tab
    this.tabs[this.tabIdCounter].id = this.tabIdCounter;

    // Increment the tab ID counter
    this.tabIdCounter++;
  }

  selectTabContent(idx) {
    const currentTab = document.querySelector(".tab-content.active");
    if (currentTab) {
      currentTab.classList.remove("active");
      currentTab.style.display = "none";
    }
    this.tabs[idx].classList.add("active");
    this.tabs[idx].style.display = "flex";

    // Append the new tab to the body
    document.body.prepend(this.tabs[idx]);

    // Notify the app that tab content has changed
    this.app.onTabContentChanged(this.tabs[idx]);
  }

  createNewTab() {
    const tabsContainer = document.querySelector(".tabs-container");
    const newTabBtn = document.querySelector(".new-tab-btn");

    // Create the new tab
    const newTab = Utils.createEl("tab");
    const tabTitle = document.createElement("span");
    tabTitle.textContent = Utils.translate("Cluster selection");
    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close-btn";
    closeBtn.textContent = "×";
    closeBtn.tabIndex = -1;

    newTab.appendChild(tabTitle);
    if (this.tabIdCounter != 0) {
      newTab.appendChild(closeBtn);
    }

    tabsContainer.insertBefore(newTab, newTabBtn);

    // Initialize the state for the new tab
    this.tabStates[this.tabIdCounter] = {
      cluster: null,
      panels: [],
    };

    newTab.id = this.tabIdCounter;

    // Activate the new tab
    this.createTabContent();
    this.activateTab(newTab);
  }

  closeTab(tab) {
    // Don't close if it's the last tab
    const allTabs = document.querySelectorAll(".tab");
    if (allTabs.length <= 1) return;

    const isActive = tab.classList.contains("active");

    // Remove the tab
    tab.remove();
    this.tabs[tab.id].remove();

    // Clean up tab state
    delete this.tabStates[tab.id];

    // If the closed tab was active, activate another tab
    if (isActive) {
      const remainingTabs = document.querySelectorAll(".tab");
      const remainingTab = remainingTabs[remainingTabs.length - 1];
      if (remainingTab) {
        this.activateTab(remainingTab);
      }
    }
  }

  activateTab(tab) {
    // Deactivate all tabs
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.remove("active");
    });

    // Restore the state of the active tab
    const tabId = parseInt(tab.id, 10);
    const tabState = this.tabStates[tabId];

    // Activate the selected tab
    tab.classList.add("active");
    this.selectTabContent(tab.id);

    // Notify the app about the tab change
    this.app.onTabActivated(tabState);
  }

  getCurrentTabState() {
    const activeTab = document.querySelector(".tab.active");
    if (activeTab) {
      return this.tabStates[activeTab.id];
    }
    return null;
  }

  updateCurrentTabState(updates) {
    const activeTab = document.querySelector(".tab.active");
    if (activeTab) {
      const tabId = activeTab.id;
      this.tabStates[tabId] = { ...this.tabStates[tabId], ...updates };
    }
  }

  updateActiveTabTitle(title) {
    const activeTab = document.querySelector(".tab.active");
    if (activeTab) {
      const titleSpan = activeTab.querySelector("span:first-child");
      titleSpan.textContent = title;
    }
  }

  getActiveTabId() {
    const activeTab = document.querySelector(".tab.active");
    return activeTab ? activeTab.id : null;
  }
}
