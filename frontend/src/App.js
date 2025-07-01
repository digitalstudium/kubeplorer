import { EventsOn, EventsOnce } from "../wailsjs/runtime/runtime.js";

import "./styles/style.css";
import { TabsManager } from "./managers/TabsManager.js";
import { ClustersManager } from "./managers/ClustersManager.js";
import { Utils } from "./utils/Utils.js";
import { ApiResourcesPanel } from "./panels/ApiResourcesPanel.js";
import { ResourcesPanel } from "./panels/ResourcesPanel.js";
import { NamespacesPanel } from "./panels/NamespacesPanel.js";

import "@fortawesome/fontawesome-free/css/all.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import yamlWorker from "monaco-yaml/yaml.worker?worker";

class App {
  constructor() {
    this.cluster = null;
    this.panels = [];
    this.clustersScreen = null;
    this.clustersList = null;
    this.mainScreen = null;
    
    // Initialize ClustersManager BEFORE TabsManager
    this.clustersManager = new ClustersManager(this);
    
    // Initialize TabsManager after ClustersManager
    this.tabsManager = new TabsManager(this);
    
    EventsOn("closeTab", () => {
      const activeTab = document.querySelector(".tab.active");
      this.tabsManager.closeTab(activeTab);
    });
  }

  // Callback method called by TabsManager when tab content changes
  onTabContentChanged(tabContent) {
    // Cache selectors for the new tab content
    this.clustersScreen = tabContent.querySelector("#clusterScreen");
    this.clustersList = tabContent.querySelector("#clusterList");
    this.mainScreen = tabContent.querySelector("#mainScreen");

    this.translateAll();
    this.setupEventListeners();
    this.clustersManager.updateClustersList(this.clustersList);
  }

  // Callback method called by TabsManager when a tab is activated
  onTabActivated(tabState) {
    this.cluster = tabState.cluster;
    this.panels = tabState.panels;
  }

  setupEventListeners() {
    EventsOn("backToClusterSelection", () => this.goBackToClusterSelection());

    const backBtn = this.mainScreen.querySelector(".back-button");
    backBtn.addEventListener("click", () => this.goBackToClusterSelection());

    this.mainScreen.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        event.preventDefault();
        const inputs = Array.from(
          this.mainScreen.getElementsByClassName("searchBox"),
        );
        const index = inputs.indexOf(document.activeElement);
        if (index > -1) {
          const nextIndex = (index + 1) % inputs.length;
          inputs[nextIndex].focus();
        }
      }
    });
  }

  translateAll() {
    this.mainScreen.querySelectorAll("[data-translate]").forEach((element) => {
      const key = element.dataset.translate;
      const translatedText = Utils.translate(key);
      if (translatedText) {
        element.placeholder === ""
          ? (element.placeholder = translatedText)
          : (element.textContent = translatedText);
      } else {
        console.warn(`Translation not found for key: ${key}`);
      }
    });
  }

  clearUIState() {
    this.panels.forEach((panel) => panel.clear());
  }

  goBackToClusterSelection() {
    this.clearUIState();
    this.cluster = null;
    
    // Update tab state and title
    this.tabsManager.updateCurrentTabState({ cluster: null, panels: [] });
    this.tabsManager.updateActiveTabTitle(Utils.translate("Cluster selection"));
    
    this.clustersScreen.classList.add("active");
    this.clustersScreen.style.display = "flex";
    this.mainScreen.classList.remove("active");
    this.mainScreen.style.display = "none";
  }

  selectCluster(cluster) {
    this.cluster = cluster;
    this.mainScreen.querySelector(".selectedClusterName").textContent = cluster;
    
    // Update tab title
    this.tabsManager.updateActiveTabTitle(cluster);
    
    this.clustersScreen.classList.remove("active");
    this.clustersScreen.style.display = "none";
    this.mainScreen.classList.add("active");
    this.mainScreen.style.display = "flex";
    this.initializeMainScreen();
  }

  async initializeMainScreen() {
    const currentTab = document.querySelector(".tab-content.active");
    document.title = `Kubeplorer - ${this.cluster}`;

    const panel1 = new NamespacesPanel(
      "panel1",
      this.cluster,
      this.mainScreen,
      currentTab,
    );
    const panel2 = new ApiResourcesPanel(
      "panel2",
      this.cluster,
      this.mainScreen,
      currentTab,
    );
    const panel3 = new ResourcesPanel(
      "panel3",
      this.cluster,
      this.mainScreen,
      currentTab,
    );

    panel3.apiResourcesPanel = panel2;
    panel3.namespacesPanel = panel1;
    panel2.resourcesPanel = panel3;
    panel2.namespacesPanel = panel1;
    panel1.resourcesPanel = panel3;
    panel1.apiResourcesPanel = panel2;

    this.panels = [panel1, panel2, panel3];

    // Update tab state with new panels
    this.tabsManager.updateCurrentTabState({ 
      cluster: this.cluster, 
      panels: this.panels 
    });

    // Setup event listeners for each panel
    this.panels.forEach((panel) => panel.setupEventListeners());

    this.translateAll();

    Utils.showLoadingIndicator("Loading cluster resources", currentTab);
    try {
      for (const panel of this.panels) {
        await panel.update();
      }
      this.updateClusterStatus();
      setInterval(() => this.updateClusterStatus(), 10000);
    } catch (error) {
      console.error("Detailed namespace fetch error:", error);
    } finally {
      Utils.hideLoadingIndicator(currentTab);
    }
  }

  async updateClusterStatus() {
    await this.clustersManager.updateClusterStatus(this.cluster, this.mainScreen);
  }
}

// Initialize the app
window.onload = () => new App();
window.MonacoEnvironment = {
  getWorker: function (_, label) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "yaml":
        return new yamlWorker();
      default:
        return new editorWorker();
    }
  },
};
