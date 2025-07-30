// frontend/src/components/ApiResourcesRenderer.js
import { Utils } from "../utils/Utils.js";

export class ApiResourcesRenderer {
  constructor(listEl, listItemClass, onGroupAction) {
    this.listEl = listEl;
    this.listItemClass = listItemClass;
    this.onGroupAction = onGroupAction; // callback для Edit/Delete группы
  }

  updateSelection(selectedApiResource) {
    const allItems = this.listEl.querySelectorAll(`.${this.listItemClass}`);
    allItems.forEach((item) => {
      item.classList.toggle(
        "selected",
        item.textContent === selectedApiResource,
      );
    });
  }

  createGroupSection(groupName, apiResources, selectedApiResource) {
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
        Edit: () => this.onGroupAction("showEditGroupModal", groupName),
        Delete: () => this.onGroupAction("deleteGroup", groupName),
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
          `<div class="${this.listItemClass} ${apiResource === selectedApiResource ? "selected" : ""}" data-api-resource="${apiResource}">${apiResource}</div>`,
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

  rebuildGroupedList(selectedApiResource, allApiResources, groups) {
    // Update the uncategorized list with the fetched apiResources
    groups.uncategorized = allApiResources.filter(
      (apiResource) =>
        !Object.values(groups.groups).flat().includes(apiResource),
    );

    // Update the UI
    this.listEl.innerHTML = "";

    // Add categorized sections
    Object.entries(groups.groups).forEach(([group, groupApiResources]) => {
      if (groupApiResources.length > 0) {
        const groupSection = this.createGroupSection(
          group,
          groupApiResources,
          selectedApiResource,
        );
        this.listEl.appendChild(groupSection);
      }
    });

    // Add uncategorized section
    if (groups.uncategorized.length > 0) {
      const uncategorizedSection = this.createGroupSection(
        Utils.translate("Uncategorized"),
        groups.uncategorized,
        selectedApiResource,
      );
      this.listEl.appendChild(uncategorizedSection);
    }
  }
}
