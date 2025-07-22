class Config {
  static lang = "en";
}
const defaultApiResourcesGroups = {
  groups: {
    Workloads: [
      "pods",
      "deployments",
      "statefulsets",
      "daemonsets",
      "replicasets",
      "cronjobs",
      "jobs",
      "horizontalpodautoscalers",
    ],
    Network: [
      "services",
      "ingresses",
      "networkpolicies",
      "endpoints",
      "endpointslices",
      "ingressclasses",
    ],
    Storage: [
      "persistentvolumes",
      "persistentvolumeclaims",
      "storageclasses",
      "csistoragecapacities",
    ],
    Config: ["configmaps", "leases"],
    Secrets: ["secrets"],
    "Access Control": [
      "roles",
      "rolebindings",
      "clusterroles",
      "clusterrolebindings",
      "serviceaccounts",
    ],
    Policy: [
      "poddisruptionbudgets",
      "validatingadmissionpolicies",
      "validatingadmissionpolicybindings",
      "validatingwebhookconfigurations",
      "mutatingwebhookconfigurations",
      "resourcequotas",
      "limitranges",
    ],
    Cluster: [
      "namespaces",
      "nodes",
      "events",
      "customresourcedefinitions",
      "runtimeclasses",
      "priorityclasses",
      "flowschemas",
      "prioritylevelconfigurations",
    ],
  },
};

const translations = {
  ru: {
    Create: "Создать",
    View: "Просмотреть",
    Update: "Обновить",
    Save: "Сохранить",
    Edit: "Изменить",
    Delete: "Удалить",
    Decode: "Декодировать",
    Name: "Имя",
    Status: "Статус",
    Ready: "Готово",
    Restarts: "Рестарты",
    Available: "Доступно",
    Age: "Возраст",
    Actions: "Действия",
    Uncategorized: "Без группы",
    Select: "Выбор",
    Logs: "Логи",
    Terminal: "Терминал",
    Copied: "Скопировано",
    resource: "русурс",
    Type: "Тип",
    cluster: "кластер",
    Events: "События",
    Search: "Поиск",
    UpToDate: "Актуально",
    "Cluster selection": "Выбор кластера",
    "No events found": "Событий не найдено",
    "Fetching events": "Получение событий",
    "Delete selected": "Удалить выбранное",
    "Input yaml here": "Добавьте yaml сюда",
    "Create resource": "Создать ресурс",
    "Resource creation": "Создание ресурса",
    "Analyze with AI": "Анализировать с ИИ",
    "Fetching data": "Получение данных",
    "Statistics:": "Статистика:",
    "no statistics available": "нет доступной статистики",
    "Select Cluster": "Выберите кластер",
    "Current cluster: ": "Текущий кластер: ",
    "Namespace selection": "Выбор пространства",
    "Resource kind selection": "Выбор вида ресурса",
    "Resources type: ": "Вид ресурса: ",
    "Selected resource kind:": "Выбран вид ресурса: ",
    "Selected namespace:": "Выбрано пространство: ",
    "Create namespace": "Создать пространство",
    "Selected:": "Выбрано: ",
    "Create group": "Создать группу",
    "Edit group": "Изменение группы",
    "Group creation": "Создание группы",
    "Back to cluster selection": "Вернуться к выбору кластера",
    "Group name": "Имя группы",
    "Please select a namespace first":
      "Пожалуйста, сначала выберите пространство",
    "No resources found in namespace": "Нет ресурсов в пространстве",
    "Error loading resources": "Ошибка загрузки ресурсов",
    "Failed to initialize application":
      "Не удалось инициализировать приложение",
    "Error fetching clusters": "Ошибка получения кластеров",
    "Error loading namespaces": "Ошибка загрузки пространств",
    "Error loading resource types": "Ошибка загрузки типов ресурсов",
    "Error fetching resources": "Ошибка получения ресурсов",
    "Are you sure you want to delete": "Вы уверены, что хотите удалить",
    "Opening terminal for pod": "Открытие терминала для пода",
    "Viewing logs for pod": "Просмотр логов для пода",
    "Loading cluster resources": "Загрузка ресурсов кластера",
    "No items found for search query": "Ничего не найдено по запросу",
  },
};

const icons = {
  Copy: "fa-copy",
  View: "fa-eye",
  Edit: "fa-pencil",
  Delete: "fa-trash",
  Terminal: "fa-terminal",
  Logs: "fa-file-lines",
  Events: "fa-triangle-exclamation",
  Decode: "fa-unlock",
  "Istio config": "fa-circle-nodes",
  "Istio registryz": "fa-globe",
};

const RESOURCE_COLUMNS = {
  pods: [
    { key: "readyStatus", title: "Ready" },
    { key: "status", title: "Status" },
    { key: "restarts", title: "Restarts" }
  ],
  deployments: [
    { key: "ready", title: "Ready" },
    { key: "upToDate", title: "UpToDate" },
    { key: "available", title: "Available" }
  ],
  services: [
    { key: "type", title: "Type" },
    { key: "clusterIP", title: "ClusterIP" },
    { key: "loadBalancerIP", title: "LoadBalancerIP" }
  ]
};

export { Config, translations, defaultApiResourcesGroups, icons, RESOURCE_COLUMNS };
