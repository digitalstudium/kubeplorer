import { EventsOn, EventsOnce } from "../wailsjs/runtime/runtime.js";

import "./styles/style.css";
import { HotkeysManager } from "./core/HotkeysManager.js";
import { BookmarksManager } from "./core/BookmarksManager.js";
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
    this.panels = [];
    this.clustersScreen = null;
    this.clustersList = null;
    this.mainScreen = null;

    // Initialize ClustersManager BEFORE TabsManager
    this.clustersManager = new ClustersManager(this);

    // Initialize TabsManager after ClustersManager
    this.tabsManager = new TabsManager(this);

    this.hotkeysManager = new HotkeysManager(this);
    this.bookmarksManager = new BookmarksManager();
    this.createBookmarksPanel();

    EventsOn("closeTab", () => {
      const activeTab = document.querySelector(".tab.active");
      this.tabsManager.closeTab(activeTab);
    });
  }

  createBookmarksPanel() {
    const bookmarksPanel = document.createElement("div");
    bookmarksPanel.className = "bookmarks-panel";

    document.body.appendChild(bookmarksPanel);

    this.bookmarksPanel = bookmarksPanel;
    this.updateBookmarksPanel();
  }

  updateBookmarksPanel() {
    if (!this.bookmarksPanel) return;

    const bookmarks = this.bookmarksManager.getBookmarks();

    // Очищаем панель
    this.bookmarksPanel.innerHTML = "";

    // Добавляем заголовок
    const label = document.createElement("span");
    label.textContent = "Bookmarks:";
    label.className = "bookmark-label";
    this.bookmarksPanel.appendChild(label);

    if (bookmarks.length === 0) {
      const emptyMsg = document.createElement("span");
      emptyMsg.textContent = "No bookmarks";
      emptyMsg.className = "bookmark-empty";
      this.bookmarksPanel.appendChild(emptyMsg);
    } else {
      bookmarks.forEach((bookmark) => {
        const bookmarkContainer = document.createElement("div");
        bookmarkContainer.className = "bookmark-container";

        const bookmarkBtn = document.createElement("button");
        bookmarkBtn.textContent = bookmark.name;
        bookmarkBtn.className = "bookmark-item";

        const deleteBtn = document.createElement("button");
        deleteBtn.innerHTML = "×";
        deleteBtn.className = "bookmark-delete";
        deleteBtn.title = "Delete bookmark";

        // Обработчики
        bookmarkBtn.addEventListener("click", () => {
          this.goToBookmark(bookmark);
        });

        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.deleteBookmark(bookmark.id);
        });

        bookmarkContainer.appendChild(bookmarkBtn);
        bookmarkContainer.appendChild(deleteBtn);
        this.bookmarksPanel.appendChild(bookmarkContainer);
      });
    }
  }

  deleteBookmark(bookmarkId) {
    if (confirm("Delete this bookmark?")) {
      this.bookmarksManager.removeBookmark(bookmarkId);
      this.updateBookmarksPanel();
    }
  }

  goToBookmark(bookmark) {
    console.log("Going to bookmark:", bookmark);

    const currentCluster = this.stateManager?.getState("selectedCluster");
    const currentNamespace = this.stateManager?.getState("selectedNamespace");
    const currentApiResource = this.stateManager?.getState(
      "selectedApiResource",
    );

    // Проверяем, не находимся ли мы уже в нужном месте
    if (
      currentCluster === bookmark.cluster &&
      currentNamespace === bookmark.namespace &&
      currentApiResource === bookmark.apiResource
    ) {
      console.log("Already at bookmark location, nothing to do");
      return;
    }

    // Если кластер отличается или stateManager нет, делаем полный цикл
    if (!this.stateManager || currentCluster !== bookmark.cluster) {
      this.goBackToClusterSelection();

      if (this.stateManager) {
        this.stateManager.setState("selectedNamespace", bookmark.namespace);
        this.stateManager.setState("selectedApiResource", bookmark.apiResource);
      }
      // Убираем setTimeout, делаем сразу
      this.selectCluster(bookmark.cluster);
    } else {
      // Кластер тот же, просто меняем namespace и apiResource
      if (this.stateManager) {
        this.stateManager.setState("selectedNamespace", bookmark.namespace);
        this.stateManager.setState("selectedApiResource", bookmark.apiResource);
      }
      this.panels[1].selectApiResourceByName(bookmark.apiResource, false);
      setTimeout(() => {
        if (this.panels && this.panels[0]) {
          this.panels[0].scrollToSelected();
        }
      }, 200);
    }
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
    this.panels = tabState.panels;
    // Получаем StateManager из состояния таба
    this.stateManager = tabState.stateManager;

    // Синхронизируем состояние с StateManager если есть данные
    if (tabState.cluster) {
      this.stateManager.setState("selectedCluster", tabState.cluster);
    }
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
    const activeTabContent = document.querySelector(".tab-content.active");
    if (activeTabContent) {
      activeTabContent
        .querySelectorAll("[data-translate]")
        .forEach((element) => {
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
  }

  clearUIState() {
    this.panels.forEach((panel) => panel.clear());
  }

  goBackToClusterSelection() {
    this.clearUIState();

    if (this.stateManager) {
      this.stateManager.setState("selectedCluster", null);
      this.stateManager.setState("selectedNamespace", null);
      this.stateManager.setState("selectedApiResource", null);
    }

    const bookmarkBtn = document.querySelector(".bookmark-btn");
    if (bookmarkBtn) {
      bookmarkBtn.remove();
    }

    // Update tab state and title
    this.tabsManager.updateCurrentTabState({ cluster: null, panels: [] });
    this.tabsManager.updateActiveTabTitle(Utils.translate("Cluster selection"));

    this.clustersScreen.classList.add("active");
    this.clustersScreen.style.display = "flex";
    this.mainScreen.classList.remove("active");
    this.mainScreen.style.display = "none";
  }

  selectCluster(cluster) {
    if (this.stateManager) {
      this.stateManager.setState("selectedCluster", cluster);
    }
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
    const cluster = this.stateManager.getState("selectedCluster");
    document.title = `Kubeplorer - ${cluster}`;

    const panel1 = new NamespacesPanel(
      "panel1",
      this.mainScreen,
      currentTab,
      this.stateManager,
    );
    const panel2 = new ApiResourcesPanel(
      "panel2",
      this.mainScreen,
      currentTab,
      this.stateManager,
    );
    const panel3 = new ResourcesPanel(
      "panel3",
      this.mainScreen,
      currentTab,
      this.stateManager,
    );

    this.panels = [panel1, panel2, panel3];

    this.createBookmarkButton(); //

    // Update tab state with new panels
    this.tabsManager.updateCurrentTabState({
      cluster: this.stateManager.getState("selectedCluster"),
      panels: this.panels,
    });

    // Setup event listeners for each panel
    this.panels.forEach((panel) => panel.setupEventListeners());

    this.translateAll();

    Utils.showLoadingIndicator("Loading cluster resources", currentTab);
    try {
      await panel1.update(); // namespace
      await panel2.update(); // api resources

      // Устанавливаем начальные значения в StateManager
      if (
        !this.stateManager.getState("selectedNamespace") &&
        panel1.selectedElText
      ) {
        this.stateManager.setState("selectedNamespace", panel1.selectedElText);
      }
      if (
        !this.stateManager.getState("selectedApiResource") &&
        panel2.selectedElText
      ) {
        this.stateManager.setState(
          "selectedApiResource",
          panel2.selectedElText,
        );
      }

      // Теперь обновляем panel3 с правильными значениями
      await panel3.update();
      setTimeout(() => {
        if (panel1) {
          panel1.scrollToSelected();
        }
      }, 200);
      this.updateClusterStatus();
      setInterval(() => this.updateClusterStatus(), 10000);
    } catch (error) {
      console.error("Detailed namespace fetch error:", error);
    } finally {
      Utils.hideLoadingIndicator(currentTab);
    }
  }

  createBookmarkButton() {
    const bookmarkBtn = document.createElement("button");
    bookmarkBtn.className = "bookmark-btn";
    bookmarkBtn.innerHTML = '<i class="fas fa-bookmark"></i>';
    bookmarkBtn.title = "Add Bookmark";
    bookmarkBtn.style.marginLeft = "10px"; // добавляем отступ

    bookmarkBtn.addEventListener("click", () => this.addCurrentBookmark());

    // Добавляем в header1Container панели 3 (рядом с create-resource-btn)
    const panel3Header = this.mainScreen.querySelector(
      ".panel3 .header1Container",
    );
    panel3Header.appendChild(bookmarkBtn);
  }

  addCurrentBookmark() {
    const cluster = this.stateManager.getState("selectedCluster");
    const namespace = this.stateManager.getState("selectedNamespace");
    const apiResource = this.stateManager.getState("selectedApiResource");

    if (cluster && namespace && apiResource) {
      const added = this.bookmarksManager.addBookmark(
        cluster,
        namespace,
        apiResource,
      );
      if (added) {
        alert("Bookmark added!");
        this.updateBookmarksPanel(); // добавьте эту строку
      } else {
        alert("Bookmark already exists!");
      }
    } else {
      alert("Please select cluster, namespace and resource type first");
    }
  }

  async updateClusterStatus() {
    const cluster = this.stateManager.getState("selectedCluster");
    await this.clustersManager.updateClusterStatus(cluster, this.mainScreen);
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
