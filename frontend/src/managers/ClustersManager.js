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
          11000,
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
        try {
          // Таймаут 5 секунд на проверку
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 10000),
          );
          console.log(`Checking connectivity for cluster ${clusterName}`);
          const isConnected = await Promise.race([
            TestClusterConnectivity(clusterName),
            timeoutPromise,
          ]);
          const statusElement = document.getElementById(
            `status-${clusterName}`,
          );
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
          console.log(
            `Fetched cluster status for ${clusterName}. Status is ${isConnected ? "connected" : "disconnected"}.`,
          );
          return { clusterName, isConnected };
        } catch (error) {
          console.error(
            `Error fetching cluster status for ${clusterName}:`,
            error,
          );
          return { clusterName, isConnected: false };
        }
      },
    );

    const clusterStatuses = await Promise.all(clusterPromises);

    clusterStatuses.forEach(({ clusterName, isConnected }) => {
      this.app.bookmarksManager.setClusterConnectivity(
        clusterName,
        isConnected,
      );
    });
    this.app.updateBookmarksDisplay();

    this.checkCurrentClusterConnectivity(clusterStatuses);

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

  checkCurrentClusterConnectivity(clusterStatuses) {
    // Проверяем только если мы находимся на главном экране
    if (!this.app.stateManager) return;

    const currentCluster = this.app.stateManager.getState("selectedCluster");
    if (!currentCluster) return;

    // Находим статус текущего кластера
    const currentClusterStatus = clusterStatuses.find(
      (status) => status.clusterName === currentCluster,
    );

    // Если текущий кластер стал недоступен, возвращаемся к выбору кластера
    if (currentClusterStatus && !currentClusterStatus.isConnected) {
      console.log(
        `Current cluster ${currentCluster} is disconnected, going back to cluster selection`,
      );
      this.app.goBackToClusterSelection();
    }
  }
}
