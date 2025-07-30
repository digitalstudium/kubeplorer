import { GroupModalWindow } from "../windows/GroupModalWindow.js";
import { Utils } from "../utils/Utils.js";

export class ApiResourcesModalHandler {
  constructor(tab, apiResourcesGroups) {
    this.tab = tab;
    this.apiResourcesGroups = apiResourcesGroups;
    this.currentEditingGroup = null;
  }

  createCheckboxList(items, checkedItems = [], prefix = "apiResource") {
    return items
      .map(
        (item) => `
          <div class="group-item">
            <input type="checkbox" id="${prefix}-${item}" value="${item}" ${checkedItems.includes(item) ? "checked" : ""}>
            <label for="${prefix}-${item}">${item}</label>
          </div>
        `,
      )
      .join("");
  }

  // Добавляем в ApiResourcesModalHandler
  showCreateGroupModal(onUpdateCallback) {
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
      () => this.createGroup(onUpdateCallback),
      "createSearchInput",
      "uncategorizedList",
    );

    const uncategorizedList = document.getElementById("uncategorizedList");
    uncategorizedList.innerHTML = this.createCheckboxList(
      this.apiResourcesGroups.uncategorized,
    );

    // Focus on the newGroupName input
    document.getElementById("newGroupName").focus();
  }
  // Добавляем в ApiResourcesModalHandler
  createGroup(onUpdateCallback) {
    const name = document.getElementById("newGroupName").value;
    if (name) {
      const selectedApiResources = Array.from(
        document.querySelectorAll(
          '#uncategorizedList input[type="checkbox"]:checked',
        ),
      ).map((checkbox) => checkbox.value);

      this.apiResourcesGroups.groups[name] = selectedApiResources;
      this.apiResourcesGroups.uncategorized =
        this.apiResourcesGroups.uncategorized.filter(
          (apiResource) => !selectedApiResources.includes(apiResource),
        );
      GroupModalWindow.saveGroups(this.apiResourcesGroups);

      // Вызываем callback для обновления UI
      if (onUpdateCallback) {
        onUpdateCallback();
      }
    }
  }

  // Добавляем в ApiResourcesModalHandler
  showEditGroupModal(groupName, onUpdateCallback) {
    this.currentEditingGroup = groupName;
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
      () => this.handleUpdateGroup(onUpdateCallback),
      "editSearchInput",
      "editResourceList",
    );

    const nameInput = document.getElementById("editGroupName");
    const resourceList = document.getElementById("editResourceList");

    // Set current group name
    nameInput.value = groupName;

    // Current group's apiResources
    const currentApiResources = this.apiResourcesGroups.groups[groupName] || [];
    // Get all available resource apiResources
    const allApiResources = new Set([
      ...currentApiResources,
      ...this.apiResourcesGroups.uncategorized,
    ]);

    // Create checkboxes for all resource apiResources
    resourceList.innerHTML = this.createCheckboxList(
      Array.from(allApiResources),
      currentApiResources,
      "edit-apiResource",
    );

    document.getElementById("editGroupName").focus();
  }

  updateGroup(oldGroupName, newName, selectedApiResources) {
    const currentApiResources =
      this.apiResourcesGroups.groups[oldGroupName] || [];

    const removedApiResources = currentApiResources.filter(
      (apiResource) => !selectedApiResources.includes(apiResource),
    );

    const newlySelectedApiResources = selectedApiResources.filter(
      (apiResource) => !currentApiResources.includes(apiResource),
    );

    this.apiResourcesGroups.uncategorized.push(...removedApiResources);

    Object.entries(this.apiResourcesGroups.groups).forEach(
      ([group, apiResources]) => {
        if (group !== oldGroupName) {
          this.apiResourcesGroups.groups[group] = apiResources.filter(
            (apiResource) => !newlySelectedApiResources.includes(apiResource),
          );
        }
      },
    );

    this.apiResourcesGroups.uncategorized =
      this.apiResourcesGroups.uncategorized.filter(
        (apiResource) => !newlySelectedApiResources.includes(apiResource),
      );

    if (newName !== oldGroupName) {
      delete this.apiResourcesGroups.groups[oldGroupName];
    }
    this.apiResourcesGroups.groups[newName] = selectedApiResources;

    GroupModalWindow.saveGroups(this.apiResourcesGroups);
  }

  deleteGroup(groupName, onUpdateCallback) {
    if (confirm(`Are you sure you want to delete the group "${groupName}"?`)) {
      const groupApiResources = this.apiResourcesGroups.groups[groupName] || [];
      this.apiResourcesGroups.uncategorized.push(...groupApiResources);
      delete this.apiResourcesGroups.groups[groupName];
      GroupModalWindow.saveGroups(this.apiResourcesGroups);

      // Вызываем callback для обновления UI
      if (onUpdateCallback) {
        onUpdateCallback();
      }
    }
  }

  handleUpdateGroup(onUpdateCallback) {
    const newName = document.getElementById("editGroupName").value;
    const selectedApiResources = Array.from(
      document.querySelectorAll(
        '#editResourceList input[type="checkbox"]:checked',
      ),
    ).map((checkbox) => checkbox.value);

    if (newName && this.currentEditingGroup) {
      this.updateGroup(this.currentEditingGroup, newName, selectedApiResources);

      if (onUpdateCallback) {
        onUpdateCallback();
      }

      this.currentEditingGroup = null;
    }
  }
}
