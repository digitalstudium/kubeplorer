import {
  GetClusters,
  TestClusterConnectivity,
} from "../../wailsjs/go/main/App.js";
import { Utils } from "../utils/Utils.js";

export class ClustersManager {
  constructor(app) {
    this.app = app;
    this._updateInterval = null;
  }

  setupClusterSearch() {
    const searchInput = document.querySelector(".cluster-search");
    const clearBtn = document.querySelector(".clusterScreen .search-clear");

    if (!searchInput || !clearBtn) return;

    // Debounced поиск
    const debouncedSearch = Utils.debounce(() => this.searchClusters(), 300);

    searchInput.addEventListener("input", () => {
      clearBtn.style.display = searchInput.value ? "block" : "none";
      debouncedSearch();
    });

    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      clearBtn.style.display = "none";
      this.searchClusters();
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        searchInput.value = "";
        clearBtn.style.display = "none";
        this.searchClusters();
      }
    });
  }

  searchClusters() {
    const searchValue =
      document.querySelector(".cluster-search")?.value.toLowerCase() || "";
    const clusterItems = document.querySelectorAll(".cluster-item");

    clusterItems.forEach((item) => {
      const clusterName = item.textContent.toLowerCase();
      item.style.display = clusterName.includes(searchValue) ? "flex" : "none";
    });
  }

  async updateClustersList(clustersList) {
    try {
      const newClusters = await GetClusters();
      let hasChanges = false;

      // Handle empty clusters case
      if (!newClusters || newClusters.length === 0) {
        const errorMessage = Utils.createErrorMessage(
          `No Kubernetes clusters found. Please check your kubeconfig.`,
        );
        if (clustersList.innerHTML !== errorMessage) {
          clustersList.innerHTML = errorMessage;
        }
        return;
      }

      // Compare with existing clusters
      const currentClusterItems =
        clustersList.querySelectorAll(".cluster-item");
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
        clustersList.innerHTML = "";
        Object.entries(newClusters).forEach(([clusterName]) => {
          const clusterItem = this.createClusterItem(clusterName);
          clustersList.appendChild(clusterItem);
        });
      }

      // Check connectivity and update statuses
      const statusChanges =
        await this.checkConnectivityWithChanges(newClusters);
      
      this.setupClusterSearch();

      // Schedule next update
      if (!this._updateInterval) {
        this._updateInterval = setInterval(
          () => this.updateClustersList(clustersList),
          1000,
        );
      }

      return hasChanges || statusChanges;
    } catch (error) {
      console.error("Error fetching clusters:", error);
      const errorMessage = Utils.createErrorMessage(
        `Error loading clusters. Please check your kubeconfig.`,
      );
      if (clustersList.innerHTML !== errorMessage) {
        clustersList.innerHTML = errorMessage;
      }
      return true;
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
              ? () => this.app.selectCluster(clusterName)
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
    clusterItem.onclick = () => this.app.selectCluster(clusterName);

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
            ? () => this.app.selectCluster(clusterName)
            : null;
        }
      },
    );

    await Promise.all(clusterPromises);
  }

  async updateClusterStatus(cluster, mainScreen) {
    if (!cluster) return;
    const isConnected = await TestClusterConnectivity(cluster);
    const statusElement = mainScreen.querySelector("#mainClusterStatus");

    if (statusElement) {
      statusElement.className = `clusterStatus ${isConnected ? "connected" : "disconnected"}`;
      statusElement.title = isConnected ? "Connected" : "Disconnected";
    }
  }

  cleanup() {
    if (this._updateInterval) {
      clearInterval(this._updateInterval);
      this._updateInterval = null;
    }
  }
}
