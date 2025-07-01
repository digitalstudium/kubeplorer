import "./style.css";
import { ApiResourcesPanel } from "./ApiResourcesPanel.js";
import { ResourcesPanel } from "./ResourcesPanel.js";
import { NamespacesPanel } from "./NamespacesPanel.js";
import { Utils } from "./Utils.js";
import { TabsManager } from "./TabsManager.js";
import {
  GetClusters,
  TestClusterConnectivity,
} from "../wailsjs/go/main/App.js";
import "@fortawesome/fontawesome-free/css/all.css";
import { EventsOn, EventsOnce } from "../wailsjs/runtime/runtime.js";

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
    
    // Initialize tabs manager
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
    this.updateClustersList();
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

  async updateClustersList() {
    try {
      const newClusters = await GetClusters();
      let hasChanges = false;

      // Handle empty clusters case
      if (!newClusters || newClusters.length === 0) {
        const errorMessage = Utils.createErrorMessage(
          `No Kubernetes clusters found. Please check your kubeconfig.`,
        );
        if (this.clustersList.innerHTML !== errorMessage) {
          this.clustersList.innerHTML = errorMessage;
        }
        return;
      }

      // Compare with existing clusters
      const currentClusterItems =
        this.clustersList.querySelectorAll(".cluster-item");
      const currentClusterNames = Array.from(currentClusterItems).map((item) =>
        item.id.replace("cluster-", ""),
      );

      // Check if cluster list has changed
      const newClusterNames = Object.keys(newClusters);
      if (
        currentClusterNames.length !== newClusterNames.length ||
        !currentClusterNames.every((name) => newClusterNames.includes(name))
      ) {
        hasChanges = true;

        // Clear and rebuild the list
        this.clustersList.innerHTML = "";
        Object.entries(newClusters).forEach(([clusterName]) => {
          const clusterItem = this.createClusterItem(clusterName);
          this.clustersList.appendChild(clusterItem);
        });
      }

      // Check connectivity and update statuses
      const statusChanges =
        await this.checkConnectivityWithChanges(newClusters);

      // Schedule next update
      if (!this._updateInterval) {
        this._updateInterval = setInterval(
          () => this.updateClustersList(),
          1000,
        );
      }

      return hasChanges || statusChanges;
    } catch (error) {
      console.error("Error fetching clusters:", error);
      const errorMessage = Utils.createErrorMessage(
        `Error loading clusters. Please check your kubeconfig.`,
      );
      if (this.clustersList.innerHTML !== errorMessage) {
        this.clustersList.innerHTML = errorMessage;
      }
      return true; // Consider error as a change
    }
  }

  async checkConnectivityWithChanges(clusters) {
    let hasChanges = false;
    const clusterPromises = Object.entries(clusters).map(
      async ([clusterName]) => {
        const isConnected = await TestClusterConnectivity(clusterName);
        const statusElement = document.getElementById(`status-${clusterName}`);
        const clusterElement = document.getElementById(
          `cluster-${clusterName}`,
        );

        if (statusElement) {
          const newStatusClass = `clusterStatus ${isConnected ? "connected" : "disconnected"}`;
          if (statusElement.className !== newStatusClass) {
            statusElement.className = newStatusClass;
            statusElement.title = isConnected ? "Connected" : "Disconnected";
            hasChanges = true;
          }
        }

        if (clusterElement) {
          const shouldBeDisabled = !isConnected;
          const isCurrentlyDisabled =
            clusterElement.classList.contains("disabled");

          if (shouldBeDisabled !== isCurrentlyDisabled) {
            clusterElement.classList.toggle("disabled", shouldBeDisabled);
            clusterElement.onclick = isConnected
              ? () => this.selectCluster(clusterName)
              : null;
            hasChanges = true;
          }
        }

        return isConnected;
      },
    );

    await Promise.all(clusterPromises);
    return hasChanges;
  }

  createClusterItem(clusterName) {
    const clusterItem = Utils.createEl("cluster-item disabled");
    clusterItem.id = `cluster-${clusterName}`;
    clusterItem.onclick = () => this.selectCluster(clusterName);

    const clusterStatus = Utils.createEl("clusterStatus checking");
    clusterStatus.id = `status-${clusterName}`;
    clusterStatus.appendChild(Utils.createIconEl("fa-circle"));

    clusterItem.append(
      clusterStatus,
      Utils.createIconEl("fa-server"),
      document.createTextNode(clusterName),
    );

    return clusterItem;
  }

  async checkConnectivity(clusters) {
    const clusterPromises = Object.entries(clusters).map(
      async ([clusterName]) => {
        const isConnected = await TestClusterConnectivity(clusterName);
        const statusElement = document.getElementById(`status-${clusterName}`);
        const clusterElement = document.getElementById(
          `cluster-${clusterName}`,
        );

        if (statusElement) {
          statusElement.className = `clusterStatus ${isConnected ? "connected" : "disconnected"}`;
          statusElement.title = isConnected ? "Connected" : "Disconnected";
        }

        if (clusterElement) {
          clusterElement.classList.toggle("disabled", !isConnected);
          clusterElement.onclick = isConnected
            ? () => this.selectCluster(clusterName)
            : null;
        }
      },
    );

    await Promise.all(clusterPromises);
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
    if (!this.cluster) return;
    const isConnected = await TestClusterConnectivity(this.cluster);
    const statusElement = this.mainScreen.querySelector("#mainClusterStatus");

    if (statusElement) {
      statusElement.className = `clusterStatus ${isConnected ? "connected" : "disconnected"}`;
      statusElement.title = isConnected ? "Connected" : "Disconnected";
    }
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
