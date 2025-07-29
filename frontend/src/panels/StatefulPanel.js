import { Panel } from "./Panel.js";

export const PANEL_STATES = {
  LOADING: "LOADING",
  LOADED: "LOADED",
  SELECTED: "SELECTED",
  UPDATING: "UPDATING",
  ERROR: "ERROR",
};

export class StatefulPanel extends Panel {
  constructor(name, container, tab, stateManager = null) {
    super(name, container, tab, stateManager);

    this.currentState = PANEL_STATES.LOADING;
    this.currentData = null; // сохраняем данные состояния
    this.stateListeners = [];

    console.log(
      `${this.constructor.name}: Initial state = ${this.currentState}`,
    );
  }

  setState(newState, newData = null) {
    const oldState = this.currentState;
    const oldData = this.currentData; // сохраняем старые данные

    // Сравниваем состояние И данные
    if (oldState === newState && this.isDataEqual(oldData, newData)) {
      return false;
    }

    console.log(`${this.constructor.name}: ${oldState} → ${newState}`);

    this.currentState = newState;
    this.currentData = newData;

    // Передаем старые и новые данные
    this.onStateChange(oldState, newState, newData, oldData);
    return true;
  }

  // Generic сравнение данных
  isDataEqual(oldData, newData) {
    // Если оба null/undefined
    if (!oldData && !newData) return true;
    if (!oldData || !newData) return false;

    // Простое сравнение объектов по ключам
    const oldKeys = Object.keys(oldData);
    const newKeys = Object.keys(newData);

    if (oldKeys.length !== newKeys.length) return false;

    return oldKeys.every((key) => oldData[key] === newData[key]);
  }

  // Получить текущее состояние
  getState() {
    return this.currentState;
  }

  // Получить данные состояния
  getStateData() {
    return this.currentData;
  }

  // Переопределяется в наследниках для обработки смены состояний
  onStateChange(oldState, newState, newData, oldData) {
    // Базовая логика - можно переопределить в наследниках
  }

  // Проверки состояний
  isLoading() {
    return this.currentState === PANEL_STATES.LOADING;
  }
  isLoaded() {
    return this.currentState === PANEL_STATES.LOADED;
  }
  isSelected() {
    return this.currentState === PANEL_STATES.SELECTED;
  }
  isUpdating() {
    return this.currentState === PANEL_STATES.UPDATING;
  }
  isError() {
    return this.currentState === PANEL_STATES.ERROR;
  }

  // Удобные проверки
  isBusy() {
    return this.isLoading() || this.isUpdating();
  }
  hasData() {
    return this.isLoaded() || this.isUpdating();
  }
  shouldShowLoader() {
    return this.isLoading();
  }
}
