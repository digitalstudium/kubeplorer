import { GetApiResources } from "../../wailsjs/go/main/App";
import { GroupModalWindow } from "../windows/GroupModalWindow";
import { Panel } from "./Panel";
import { Utils } from "../utils/Utils";
import { defaultApiResourcesGroups } from "../utils/Config";

let currentEditingGroup = null;
export let apiResourcesGroups = defaultApiResourcesGroups;
const storedGroups = localStorage.getItem("resourceGroups");
if (storedGroups) {
  apiResourcesGroups = JSON.parse(storedGroups);
}

export class ApiResourcesPanel extends Panel {
  constructor(name, cluster, container, tab, stateManager = null) {
    super(name, cluster, container, tab);
    this.stateManager = stateManager;
    this.namespacesPanel = null;
    this.resourcesPanel = null;
    this.selectedElText = "pods";
    this.buttonEl = document.querySelector(".create-group-btn");
    this.buttonFunction = () => this.showCreateGroupModal();
  }
  async update() {
    // Fetch resource apiResources from the API
    let apiResourcesMap = {};
    try {
      apiResourcesMap = await GetApiResources(this.cluster);
    } catch (error) {
      console.warn("Cannot load api resources:", error);
    }

    // Initialize a Set to store all unique resource apiResources
    let allApiResources = new Set();

    // Iterate over the API resources map
    Object.values(apiResourcesMap).forEach((group) => {
      // Add each api resource to the allApiResources Set
      group.forEach((resource) => allApiResources.add(resource.Name));
    });

    // Convert the Set to an array
    allApiResources = Array.from(allApiResources);

    // Update the uncategorized list with the fetched apiResources
    apiResourcesGroups.uncategorized = allApiResources.filter(
      (apiResource) =>
        !Object.values(apiResourcesGroups.groups).flat().includes(apiResource),
    );

    // Update the UI
    this.listEl.innerHTML = "";

    // Add categorized sections
    Object.entries(apiResourcesGroups.groups).forEach(
      ([group, groupApiResources]) => {
        if (groupApiResources.length > 0) {
          const groupSection = this.createGroupSection(
            group,
            groupApiResources,
          );
          this.listEl.appendChild(groupSection);
        }
      },
    );

    // Add uncategorized section
    if (apiResourcesGroups.uncategorized.length > 0) {
      const uncategorizedSection = this.createGroupSection(
        Utils.translate("Uncategorized"),
        apiResourcesGroups.uncategorized,
      );
      this.listEl.appendChild(uncategorizedSection);
    }
    this.selectedEl = this.listEl.querySelector(".selected");
    // Save groups after update
    GroupModalWindow.saveGroups(apiResourcesGroups);
  }

  createGroupSection(groupName, apiResources) {
    const section = Utils.createEl("group-section");

    // Create header with caret and title
    const header = Utils.createEl("group-header");

    const titleContainer = document.createElement("div");

    const caret = Utils.createEl("caret", "", "span");
    caret.innerHTML = "&#9662;";

    const title = Utils.createEl("", groupName, "span");

    titleContainer.append(caret, title);
    header.append(titleContainer);

    if (groupName !== Utils.translate("Uncategorized")) {
      const controls = Utils.createEl("group-controls");
      const actionButtonsContainer = Utils.createEl("action-buttons");
      const actions = {
        Edit: () => this.showEditGroupModal(groupName),
        Delete: () => this.deleteGroup(groupName),
      };
      for (const action in actions) {
        actionButtonsContainer.append(
          Utils.createActionBtn(action, groupName, actions[action]),
        );
      }
      controls.append(actionButtonsContainer);
      header.append(controls);
    }

    // Create content
    const content = Utils.createEl("group-content");
    content.innerHTML = apiResources
      .map(
        (apiResource) =>
          `<div class="${this.listItemClass} ${apiResource === this.selectedElText ? "selected" : ""}" data-api-resource="${apiResource}">${apiResource}</div>`,
      )
      .join("");

    header.classList.add("collapsed");
    content.classList.add("collapsed");

    header.addEventListener("click", (e) => {
      if (!e.target.closest(".group-controls")) {
        header.classList.toggle("collapsed");
        content.classList.toggle("collapsed");
      }
    });

    section.append(header, content);
    return section;
  }

  showCreateGroupModal() {
    const modalContent = `
      <input
        type="text"
        id="newGroupName"
        placeholder="${Utils.translate("Group name")}"
      />
      <input
        type="text"
        class="search-input"
        id="createSearchInput"
        placeholder="${Utils.translate("Search")}..."
      />
      <div class="group-list" id="uncategorizedList"></div>
      `;

    new GroupModalWindow(
      this.tab,
      modalContent,
      "modal-content",
      "Group creation",
      "Create",
      () => this.createGroup(),
      "createSearchInput",
      "uncategorizedList",
    );

    const uncategorizedList = document.getElementById("uncategorizedList");
    uncategorizedList.innerHTML = apiResourcesGroups.uncategorized
      .map(
        (apiResource) => `
          <div class="group-item">
              <input type="checkbox" id="apiResource-${apiResource}" value="${apiResource}">
              <label for="apiResource-${apiResource}">${apiResource}</label>
          </div>
      `,
      )
      .join("");

    // Focus on the newGroupName input
    document.getElementById("newGroupName").focus();
  }

  showEditGroupModal(groupName) {
    currentEditingGroup = groupName;
    const modalContent = `
      <input
        type="text"
        id="editGroupName"
        placeholder="${Utils.translate("Group name")}"
      />
      <input
        type="text"
        class="search-input"
        id="editSearchInput"
        placeholder="${Utils.translate("Search")}..."
      />
      <div class="group-list" id="editResourceList"></div>
      `;

    new GroupModalWindow(
      this.tab,
      modalContent,
      "modal-content",
      "Edit group",
      "Edit",
      () => this.updateGroup(),
      "editSearchInput",
      "editResourceList",
    );

    const nameInput = document.getElementById("editGroupName");
    const resourceList = document.getElementById("editResourceList");

    // Set current group name
    nameInput.value = groupName;

    // Current group's apiResources
    const currentApiResources = apiResourcesGroups.groups[groupName] || [];
    // Get all available resource apiResources
    const allApiResources = new Set([
      ...currentApiResources,
      ...apiResourcesGroups.uncategorized,
    ]);

    // Create checkboxes for all resource apiResources
    resourceList.innerHTML = Array.from(allApiResources)
      .map(
        (apiResource) => `
          <div class="group-item">
              <input type="checkbox" id="edit-apiResource-${apiResource}" value="${apiResource}"
                     ${currentApiResources.includes(apiResource) ? "checked" : ""}>
              <label for="edit-apiResource-${apiResource}">${apiResource}</label>
          </div>
      `,
      )
      .join("");

    document.getElementById("editGroupName").focus();
  }

  createGroup() {
    const name = document.getElementById("newGroupName").value;
    if (name) {
      const selectedApiResources = Array.from(
        document.querySelectorAll(
          '#uncategorizedList input[type="checkbox"]:checked',
        ),
      ).map((checkbox) => checkbox.value);

      apiResourcesGroups.groups[name] = selectedApiResources;
      apiResourcesGroups.uncategorized =
        apiResourcesGroups.uncategorized.filter(
          (apiResource) => !selectedApiResources.includes(apiResource),
        );
      this.update();
    }
  }
  deleteGroup(groupName) {
    if (confirm(`Are you sure you want to delete the group "${groupName}"?`)) {
      // Move all apiResources from the group back to uncategorized
      const groupApiResources = apiResourcesGroups.groups[groupName] || [];
      apiResourcesGroups.uncategorized.push(...groupApiResources);

      // Delete the group
      delete apiResourcesGroups.groups[groupName];

      // Update the UI
      this.update();
    }
  }

  updateGroup() {
    const newName = document.getElementById("editGroupName").value;
    const selectedApiResources = Array.from(
      document.querySelectorAll(
        '#editResourceList input[type="checkbox"]:checked',
      ),
    ).map((checkbox) => checkbox.value);

    if (newName && currentEditingGroup) {
      // Get current apiResources in the group
      const currentApiResources =
        apiResourcesGroups.groups[currentEditingGroup] || [];

      // Find apiResources that were unchecked (removed from group)
      const removedApiResources = currentApiResources.filter(
        (apiResource) => !selectedApiResources.includes(apiResource),
      );

      // Find newly selected apiResources (not in current group)
      const newlySelectedApiResources = selectedApiResources.filter(
        (apiResource) => !currentApiResources.includes(apiResource),
      );

      // Move removed apiResources to uncategorized
      apiResourcesGroups.uncategorized.push(...removedApiResources);

      // Remove newly selected apiResources from uncategorized and other groups
      Object.entries(apiResourcesGroups.groups).forEach(
        ([group, apiResources]) => {
          if (group !== currentEditingGroup) {
            apiResourcesGroups.groups[group] = apiResources.filter(
              (apiResource) => !newlySelectedApiResources.includes(apiResource),
            );
          }
        },
      );
      apiResourcesGroups.uncategorized =
        apiResourcesGroups.uncategorized.filter(
          (apiResource) => !newlySelectedApiResources.includes(apiResource),
        );

      // Update or rename the group
      if (newName !== currentEditingGroup) {
        delete apiResourcesGroups.groups[currentEditingGroup];
      }
      apiResourcesGroups.groups[newName] = selectedApiResources;

      this.update();
      currentEditingGroup = null;
    }
  }

  select(event) {
    const newSelection = super.select(event);
    if (!newSelection) {
      return;
    }
    if (this.stateManager) {
      const apiResource = newSelection.dataset.apiResource || newSelection.textContent;
      this.stateManager.setState('selectedApiResource', apiResource);
    }
  }
  search() {
    super.search();
    // так как список api ресурсов сгруппирован, названия групп нужно скрывать если в ней ничего не нашлось
    const groups = document.querySelectorAll(".group-section");
    Array.from(groups).forEach((group) => {
      const items = group.getElementsByClassName(this.listItemClass);
      let hasVisibleItem = false;
      Array.from(items).forEach((item) => {
        if (item.style.display !== "none") hasVisibleItem = true;
      });
      group.style.display = hasVisibleItem ? "block" : "none";
      if (this.searchBoxEl.value) {
        if (hasVisibleItem) {
          group.querySelector(".group-header").classList.remove("collapsed");
          group.querySelector(".group-content").classList.remove("collapsed");
        }
      } else {
        group.querySelector(".group-header").classList.add("collapsed");
        group.querySelector(".group-content").classList.add("collapsed");
      }
    });
  }
}
