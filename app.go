package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/client-go/tools/remotecommand"
	"sigs.k8s.io/yaml"
)

const (
	defaultNamespace = "default"
	timeFormat       = time.RFC3339
)

// App holds the application context
type App struct {
	ctx                     context.Context
	managementClusters      map[string][]string // management cluster name -> API server IPs of managed clusters
	mgmtClustersInitialized bool
	mgmtClustersMutex       sync.RWMutex
}

// NewApp creates a new App.
func NewApp() *App {
	return &App{
		managementClusters: make(map[string][]string),
	}
}

// startup is called when the app starts. The context is saved
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go a.StartWebSocketServer()
}

// Replace all your extraction functions with these:
func extract[T any](obj map[string]interface{}, key string, defaultVal T) T {
	if val, ok := obj[key].(T); ok {
		return val
	}
	return defaultVal
}

func extractMap(obj map[string]interface{}, key string) map[string]interface{} {
	return extract(obj, key, map[string]interface{}{})
}

func extractString(obj map[string]interface{}, key string) string {
	return extract(obj, key, "")
}

func extractInt64(obj map[string]interface{}, key string) int64 {
	return extract(obj, key, int64(0))
}

func extractSlice(obj map[string]interface{}, key string) []interface{} {
	return extract(obj, key, []interface{}{})
}

// Consolidated clients struct
type KubeClients struct {
	Clientset     *kubernetes.Clientset
	DynamicClient dynamic.Interface
	RestConfig    *rest.Config
}

func (a *App) getKubeClients(clusterName string) (*KubeClients, error) {
	config, err := getClientConfig(clusterName)
	if err != nil {
		return nil, err
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	return &KubeClients{
		Clientset:     clientset,
		DynamicClient: dynamicClient,
		RestConfig:    config,
	}, nil
}

// Consolidated resource finding
func (a *App) findResourceInfo(clusterName, resourceName string) (ResourceInfo, schema.GroupVersionResource, error) {
	apiResources, err := a.GetApiResources(clusterName)
	if err != nil {
		return ResourceInfo{}, schema.GroupVersionResource{}, fmt.Errorf("failed to get API resources: %w", err)
	}

	for _, resources := range apiResources {
		for _, r := range resources {
			if strings.EqualFold(r.Name, resourceName) {
				gv, err := schema.ParseGroupVersion(r.Version)
				if err != nil {
					return ResourceInfo{}, schema.GroupVersionResource{}, fmt.Errorf("failed to parse group version %q: %w", r.Version, err)
				}

				gvr := schema.GroupVersionResource{
					Group:    gv.Group,
					Version:  gv.Version,
					Resource: r.Name,
				}
				return r, gvr, nil
			}
		}
	}
	return ResourceInfo{}, schema.GroupVersionResource{}, fmt.Errorf("resource %q not found", resourceName)
}

// loadKubeConfig loads the default kubeconfig.
func loadKubeConfig() (clientcmdapi.Config, error) {
	kubeConfig, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		clientcmd.NewDefaultClientConfigLoadingRules(),
		&clientcmd.ConfigOverrides{},
	).RawConfig()
	if err != nil {
		return clientcmdapi.Config{}, fmt.Errorf("error loading kubeconfig: %w", err)
	}
	return kubeConfig, nil
}

// getClientset returns a typed clientset for a given cluster (context).
func getClientConfig(clusterName string) (*rest.Config, error) {
	kubeConfig, err := loadKubeConfig()
	if err != nil {
		return nil, err
	}
	if _, exists := kubeConfig.Contexts[clusterName]; !exists {
		return nil, fmt.Errorf("context %q not found", clusterName)
	}
	clientConfig := clientcmd.NewDefaultClientConfig(
		kubeConfig,
		&clientcmd.ConfigOverrides{CurrentContext: clusterName},
	)
	restConfig, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, err
	}

	// Add timeout settings
	restConfig.Timeout = 30 * time.Second
	restConfig.Dial = (&net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext
	// restConfig.TLSClientConfig.InsecureSkipVerify = false

	// Check if we have a proxy-url
	if context, ok := kubeConfig.Contexts[clusterName]; ok {
		if cluster, ok := kubeConfig.Clusters[context.Cluster]; ok {
			if cluster.ProxyURL != "" {
				restConfig.Proxy = func(req *http.Request) (*url.URL, error) {
					proxyURL, err := url.Parse(cluster.ProxyURL)
					if err != nil {
						return nil, fmt.Errorf("invalid proxy URL: %w", err)
					}
					return proxyURL, nil
				}
			}
		}
	}

	return restConfig, nil
}

// TestClusterConnectivity attempts to list Nodes in a cluster to verify credentials and connectivity.
func (a *App) TestClusterConnectivity(clusterName string) bool {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		log.Printf("Connectivity test failed for %s: %v", clusterName, err)
		return false
	}

	_, err = clients.Clientset.CoreV1().Nodes().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		// A 403 means we are at least authenticated, just not authorized
		if statusErr, ok := err.(*errors.StatusError); ok && statusErr.Status().Code == 403 {
			return true
		}
		return false
	}
	return true
}

// GetClusters returns all contexts in the user’s kubeconfig.
func (a *App) GetClusters() map[string]*clientcmdapi.Context {
	kubeConfig, err := loadKubeConfig()
	if err != nil {
		log.Printf("Failed to load clusters: %v", err)
		return nil
	}
	return kubeConfig.Contexts
}

// GetNamespaces retrieves the list of namespaces for a given cluster.
// If the user lacks permission, the function falls back to the current context's namespace.
func (a *App) GetNamespaces(clusterName string) ([]string, error) {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return nil, err
	}

	kubeConfig, err := loadKubeConfig()
	if err != nil {
		return nil, err
	}

	contextObject, exists := kubeConfig.Contexts[clusterName]
	if !exists {
		return nil, fmt.Errorf("context %q not found in kubeconfig", clusterName)
	}

	namespaces, err := clients.Clientset.CoreV1().Namespaces().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		// If it's a 403, return the context's default namespace
		if statusErr, ok := err.(*errors.StatusError); ok && statusErr.Status().Code == 403 {
			ns := contextObject.Namespace
			if ns == "" {
				ns = defaultNamespace
			}
			log.Printf("No permission to list namespaces in %s, falling back to %q", clusterName, ns)
			return []string{ns}, nil
		}
		return nil, err
	}

	var namespaceNames []string
	for _, ns := range namespaces.Items {
		if ns.Name != "" {
			namespaceNames = append(namespaceNames, ns.Name)
		}
	}

	if len(namespaceNames) == 0 {
		return nil, fmt.Errorf("no namespaces found for cluster %s", clusterName)
	}
	return namespaceNames, nil
}

// GetDefaultNamespace returns the default namespace from the kubeconfig context, or "default" if unset.
func (a *App) GetDefaultNamespace(clusterName string) (string, error) {
	kubeConfig, err := loadKubeConfig()
	if err != nil {
		return "", err
	}

	contextObject, exists := kubeConfig.Contexts[clusterName]
	if !exists {
		return "", fmt.Errorf("context %q not found in kubeconfig", clusterName)
	}

	if contextObject.Namespace == "" {
		return defaultNamespace, nil
	}
	return contextObject.Namespace, nil
}

// ResourceInfo holds information about a single resource
type ResourceInfo struct {
	Name       string
	Kind       string
	Version    string
	Namespaced bool
}

// APIResourceMap is a map of group names to slices of ResourceInfo
type APIResourceMap map[string][]ResourceInfo

// GetApiResources retrieves API resources that are allowed to list for the specified cluster.
func (a *App) GetApiResources(clusterName string) (APIResourceMap, error) {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return nil, fmt.Errorf("failed to get clients: %w", err)
	}

	discoveryClient := discovery.NewDiscoveryClient(clients.Clientset.RESTClient())

	_, apiGroupResources, err := discoveryClient.ServerGroupsAndResources()
	if err != nil {
		if discoveryErr, ok := err.(*discovery.ErrGroupDiscoveryFailed); ok {
			log.Printf("Partial API group discovery failure: %v", discoveryErr.Groups)
		} else {
			return nil, fmt.Errorf("failed to retrieve API resources: %w", err)
		}
	}

	apiResourcesMap := make(APIResourceMap)

	for _, groupResource := range apiGroupResources {
		groupVersion := groupResource.GroupVersion

		if strings.HasPrefix(groupVersion, "metrics.k8s.io") {
			continue
		}

		for _, resource := range groupResource.APIResources {
			if strings.Contains(resource.Name, "/") {
				continue
			}

			if slices.Contains(resource.Verbs, "list") {
				apiResourcesMap[groupVersion] = append(apiResourcesMap[groupVersion], ResourceInfo{
					Name:       resource.Name,
					Kind:       resource.Kind,
					Version:    groupVersion,
					Namespaced: resource.Namespaced,
				})
			}
		}
	}

	return apiResourcesMap, nil
}

// ResourceResponse describes a single Kubernetes resource in a simpler form.
type ResourceResponse struct {
	Name     string                 `json:"name"`
	Kind     string                 `json:"kind"`
	Metadata map[string]interface{} `json:"metadata"`
	Spec     map[string]interface{} `json:"spec"`
	Age      string                 `json:"age"`
}

// PodResponse extends ResourceResponse with Pod-specific fields.
type PodResponse struct {
	ResourceResponse
	Status      string   `json:"status"`
	Restarts    int32    `json:"restarts"`
	ReadyStatus string   `json:"readyStatus"`
	Containers  []string `json:"containers"` // New field for container names (including init containers)
}

// DeploymentResponse extends ResourceResponse with Deployment-specific fields.
type DeploymentResponse struct {
	ResourceResponse
	Ready     string `json:"ready"`     // Format like "0/20"
	UpToDate  int32  `json:"upToDate"`  // Number of up-to-date replicas
	Available int32  `json:"available"` // Number of available replicas
}

// formatAge converts a creation timestamp to a human-readable relative time.
func formatAge(timestamp string) string {
	t, err := time.Parse(timeFormat, timestamp)
	if err != nil {
		return "N/A"
	}

	duration := time.Since(t)

	switch {
	case duration.Hours() >= 24:
		days := int(duration.Hours() / 24)
		return fmt.Sprintf("%dd", days)
	case duration.Hours() >= 1:
		return fmt.Sprintf("%dh", int(duration.Hours()))
	case duration.Minutes() >= 1:
		return fmt.Sprintf("%dm", int(duration.Minutes()))
	default:
		return fmt.Sprintf("%ds", int(duration.Seconds()))
	}
}

// GetResourcesInNamespace retrieves resources of a given type from a specific namespace in a cluster.
// First, create helper functions for pod and deployment processing:
func calculatePodStatus(pod unstructured.Unstructured) (status string, restarts int32, readyStatus string) {
	if pod.GetDeletionTimestamp() != nil {
		return "Terminating", 0, calculatePodReadyStatus(pod)
	}

	statusObj := extractMap(pod.Object, "status")
	status = extractString(statusObj, "phase")

	if containerStatuses := extractSlice(statusObj, "containerStatuses"); len(containerStatuses) > 0 {
		for _, cs := range containerStatuses {
			if container, ok := cs.(map[string]interface{}); ok {
				restarts += int32(extractInt64(container, "restartCount"))

				// Check for waiting/terminated states
				if state := extractMap(container, "state"); len(state) > 0 {
					if waiting := extractMap(state, "waiting"); len(waiting) > 0 {
						if reason := extractString(waiting, "reason"); reason != "" {
							status = reason
							break
						}
					} else if terminated := extractMap(state, "terminated"); len(terminated) > 0 {
						if reason := extractString(terminated, "reason"); reason != "" {
							status = reason
							break
						}
					}
				}
			}
		}
	}

	return status, restarts, calculatePodReadyStatus(pod)
}

func extractContainerNames(spec map[string]interface{}) []string {
	var containerNames []string

	// Init containers
	for _, initC := range extractSlice(spec, "initContainers") {
		if m, ok := initC.(map[string]interface{}); ok {
			if name := extractString(m, "name"); name != "" {
				containerNames = append(containerNames, name)
			}
		}
	}

	// Regular containers
	for _, c := range extractSlice(spec, "containers") {
		if m, ok := c.(map[string]interface{}); ok {
			if name := extractString(m, "name"); name != "" {
				containerNames = append(containerNames, name)
			}
		}
	}

	return containerNames
}

// Now the simplified main function:
func (a *App) GetResourcesInNamespace(clusterName, resourceName, namespace string) ([]interface{}, error) {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return nil, err
	}

	resourceInfo, gvr, err := a.findResourceInfo(clusterName, resourceName)
	if err != nil {
		return nil, err
	}

	var list *unstructured.UnstructuredList
	if resourceInfo.Namespaced {
		list, err = clients.DynamicClient.Resource(gvr).Namespace(namespace).List(context.Background(), metav1.ListOptions{})
	} else {
		list, err = clients.DynamicClient.Resource(gvr).List(context.Background(), metav1.ListOptions{})
	}
	if err != nil {
		return nil, fmt.Errorf("failed to list resources: %w", err)
	}

	var responses []interface{}
	for _, item := range list.Items {
		base := ResourceResponse{
			Name:     item.GetName(),
			Kind:     item.GetKind(),
			Metadata: extractMap(item.Object, "metadata"),
			Spec:     extractMap(item.Object, "spec"),
			Age:      formatAge(item.GetCreationTimestamp().Format(timeFormat)),
		}

		switch strings.ToLower(resourceInfo.Kind) {
		case "pod":
			status, restarts, readyStatus := calculatePodStatus(item)
			pod := PodResponse{
				ResourceResponse: base,
				Status:           status,
				Restarts:         restarts,
				ReadyStatus:      readyStatus,
				Containers:       extractContainerNames(extractMap(item.Object, "spec")),
			}
			responses = append(responses, pod)
		case "deployment":
			deployment, err := extractDeploymentFields(item)
			if err != nil {
				log.Printf("Error extracting deployment fields: %v", err)
				continue
			}
			responses = append(responses, deployment)
		default:
			responses = append(responses, base)
		}
	}
	return responses, nil
}

// GetResourceYAML retrieves the YAML representation of a specific resource
func (a *App) GetResourceYAML(clusterName, resourceName, namespace, name string) (string, error) {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return "", err
	}

	resourceInfo, gvr, err := a.findResourceInfo(clusterName, resourceName)
	if err != nil {
		return "", err
	}

	var obj *unstructured.Unstructured
	if resourceInfo.Namespaced {
		obj, err = clients.DynamicClient.Resource(gvr).Namespace(namespace).Get(context.Background(), name, metav1.GetOptions{})
	} else {
		obj, err = clients.DynamicClient.Resource(gvr).Get(context.Background(), name, metav1.GetOptions{})
	}
	if err != nil {
		return "", fmt.Errorf("failed to get resource: %w", err)
	}

	// Clean up metadata
	if metadata := extractMap(obj.Object, "metadata"); len(metadata) > 0 {
		for _, field := range []string{"creationTimestamp", "resourceVersion", "uid", "managedFields"} {
			delete(metadata, field)
		}
	}

	yamlBytes, err := yaml.Marshal(obj.Object)
	if err != nil {
		return "", fmt.Errorf("failed to encode resource as YAML: %w", err)
	}
	return string(yamlBytes), nil
}

// DeleteResource deletes a specified resource in the given cluster and namespace.
func (a *App) DeleteResource(clusterName, namespace, apiResource, name string) error {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return fmt.Errorf("failed to get clients: %w", err)
	}

	resourceInfo, gvr, err := a.findResourceInfo(clusterName, apiResource)
	if err != nil {
		return err
	}

	if resourceInfo.Namespaced {
		err = clients.DynamicClient.Resource(gvr).Namespace(namespace).Delete(context.Background(), name, metav1.DeleteOptions{})
	} else {
		err = clients.DynamicClient.Resource(gvr).Delete(context.Background(), name, metav1.DeleteOptions{})
	}

	if err != nil {
		if errors.IsNotFound(err) {
			return fmt.Errorf("resource %q of type %q not found in namespace %q", name, apiResource, namespace)
		}
		return fmt.Errorf("failed to delete resource %q of type %q: %w", name, apiResource, err)
	}

	log.Printf("Resource %q of type %q deleted successfully from namespace %q in cluster %q", name, apiResource, namespace, clusterName)
	return nil
}

// GetPodContainerLogs retrieves logs for a specific container in a pod
func (a *App) GetPodContainerLogs(clusterName, namespace, podName, containerName string) (string, error) {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return "", fmt.Errorf("failed to get clientset: %w", err)
	}

	req := clients.Clientset.CoreV1().Pods(namespace).GetLogs(podName, &corev1.PodLogOptions{
		Container: containerName,
		Follow:    false,
	})

	podLogs, err := req.Stream(context.Background())
	if err != nil {
		return "", fmt.Errorf("failed to get logs stream: %w", err)
	}
	defer podLogs.Close()

	buf := new(bytes.Buffer)
	if _, err := io.Copy(buf, podLogs); err != nil {
		return "", fmt.Errorf("failed to read logs stream: %w", err)
	}

	return buf.String(), nil
}

func calculatePodReadyStatus(pod unstructured.Unstructured) string {
	// Extract the pod's status and spec
	status := extractMap(pod.Object, "status")
	spec := extractMap(pod.Object, "spec")

	// Get the container statuses
	containerStatuses, ok := status["containerStatuses"].([]interface{})
	if !ok {
		containerStatuses = []interface{}{}
	}

	// Get the init container statuses
	initContainerStatuses, ok := status["initContainerStatuses"].([]interface{})
	if !ok {
		initContainerStatuses = []interface{}{}
	}

	// Extract the list of containers from the spec
	containers := extractSlice(spec, "containers")

	// Count only regular containers for totalContainers
	totalContainers := len(containers)

	// Count only running init containers for totalContainers
	for _, initContainerStatus := range initContainerStatuses {
		if ics, ok := initContainerStatus.(map[string]interface{}); ok {
			if state, ok := ics["state"].(map[string]interface{}); ok {
				if _, ok := state["running"]; ok {
					totalContainers++
				}
			}
		}
	}

	if totalContainers == 0 {
		return "0/0"
	}

	readyCount := 0

	// Check container statuses
	for _, containerStatus := range containerStatuses {
		if cs, ok := containerStatus.(map[string]interface{}); ok {
			if ready, ok := cs["ready"].(bool); ok && ready {
				readyCount++
			}
		}
	}

	// Check init container statuses, counting only running and ready ones
	for _, initContainerStatus := range initContainerStatuses {
		if ics, ok := initContainerStatus.(map[string]interface{}); ok {
			if state, ok := ics["state"].(map[string]interface{}); ok {
				if _, ok := state["running"]; ok {
					if ready, ok := ics["ready"].(bool); ok && ready {
						readyCount++
					}
				}
			}
		}
	}

	return fmt.Sprintf("%d/%d", readyCount, totalContainers)
}

// extractDeploymentFields extracts deployment-specific fields from an unstructured object
func extractDeploymentFields(item unstructured.Unstructured) (DeploymentResponse, error) {
	// Base resource information
	deployment := DeploymentResponse{
		ResourceResponse: ResourceResponse{
			Name:     item.GetName(),
			Kind:     item.GetKind(),
			Metadata: extractMap(item.Object, "metadata"),
			Spec:     extractMap(item.Object, "spec"),
			Age:      formatAge(item.GetCreationTimestamp().Format(timeFormat)),
		},
	}

	// Extract status
	status := extractMap(item.Object, "status")

	// Ready replicas calculation
	spec := extractMap(item.Object, "spec")
	replicas := extractInt64(spec, "replicas")
	if replicas == 0 {
		// If no replicas specified, try to get from status
		replicas = extractInt64(status, "replicas")
	}

	// Up-to-date replicas
	upToDateReplicas := extractInt64(status, "updatedReplicas")
	deployment.UpToDate = int32(upToDateReplicas)

	// Available replicas
	availableReplicas := extractInt64(status, "availableReplicas")
	deployment.Available = int32(availableReplicas)

	// Ready status
	deployment.Ready = fmt.Sprintf("%d/%d", availableReplicas, replicas)

	return deployment, nil
}

type OllamaProxy struct{}

func (p *OllamaProxy) ForwardToOllama(requestBody string) (string, error) {
	// Forward request to Ollama
	resp, err := http.Post(
		"http://localhost:11434/api/generate",
		"application/json",
		bytes.NewBufferString(requestBody),
	)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// Read response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(body), nil
}

// ApplyResource applies a Kubernetes resource from YAML to the specified cluster.
func (a *App) ApplyResource(clusterName string, yamlContent string) error {
	obj := &unstructured.Unstructured{}
	if err := yaml.Unmarshal([]byte(yamlContent), obj); err != nil {
		return fmt.Errorf("failed to decode YAML: %w", err)
	}

	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return fmt.Errorf("failed to get clients: %w", err)
	}

	gvk := obj.GroupVersionKind()
	gvr := schema.GroupVersionResource{
		Group:    gvk.Group,
		Version:  gvk.Version,
		Resource: strings.ToLower(gvk.Kind) + "s",
	}

	namespace := obj.GetNamespace()
	if namespace == "" {
		namespace = defaultNamespace
	}

	existingObj, err := clients.DynamicClient.Resource(gvr).Namespace(namespace).Get(context.Background(), obj.GetName(), metav1.GetOptions{})
	if err != nil {
		if !errors.IsNotFound(err) {
			return fmt.Errorf("failed to check if resource exists: %w", err)
		}
		// Create new resource
		_, err := clients.DynamicClient.Resource(gvr).Namespace(namespace).Create(context.Background(), obj, metav1.CreateOptions{})
		if err != nil {
			return fmt.Errorf("failed to create resource: %w", err)
		}
		log.Printf("Resource %q of type %q created successfully in namespace %q in cluster %q", obj.GetName(), gvk.Kind, namespace, clusterName)
		return nil
	}

	// Update existing resource
	obj.SetResourceVersion(existingObj.GetResourceVersion())
	_, err = clients.DynamicClient.Resource(gvr).Namespace(namespace).Update(context.Background(), obj, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to update resource: %w", err)
	}
	log.Printf("Resource %q of type %q updated successfully in namespace %q in cluster %q", obj.GetName(), gvk.Kind, namespace, clusterName)
	return nil
}

// WebSocket configuration
var upgrader = websocket.Upgrader{
	EnableCompression: true,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
}

// StartWebSocketServer initializes the WebSocket server for terminal sessions
func (a *App) StartWebSocketServer() {
	http.HandleFunc("/terminal", a.handleTerminalWebSocket)
	http.HandleFunc("/envoy", a.handleEnvoyConfig)
	port := "34116"
	log.Printf("WebSocket server listening on port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("WebSocket server failed: %v", err)
	}
}

// Define a custom TerminalSizeQueue implementation
type terminalSizeQueue struct {
	sizes chan remotecommand.TerminalSize
	ctx   context.Context
}

func (q *terminalSizeQueue) Next() *remotecommand.TerminalSize {
	select {
	case size := <-q.sizes:
		return &size
	case <-q.ctx.Done():
		return nil
	}
}

// Handle WebSocket connections for terminal sessions
func (a *App) handleTerminalWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	query := r.URL.Query()
	clusterName := query.Get("cluster")
	namespace := query.Get("namespace")
	podName := query.Get("pod")
	containerName := query.Get("container")

	command := []string{"/bin/sh"}
	if commandParam := query.Get("command"); commandParam != "" {
		command = strings.Split(commandParam, ",")
	}

	if clusterName == "" || namespace == "" || podName == "" || containerName == "" {
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Missing required parameters"))
		return
	}

	config, req, err := a.setupExecRequest(clusterName, namespace, podName, containerName, command, true)
	if err != nil {
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, err.Error()))
		return
	}

	executor, err := remotecommand.NewSPDYExecutor(config, "POST", req.URL())
	if err != nil {
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, err.Error()))
		return
	}

	// Set up bidirectional streams
	stdinReader, stdinWriter := io.Pipe()
	stdoutReader, stdoutWriter := io.Pipe()
	_, stderrWriter := io.Pipe()

	sizeChan := make(chan remotecommand.TerminalSize, 1)
	tsQueue := &terminalSizeQueue{
		sizes: sizeChan,
		ctx:   ctx,
	}

	// Use wait group for proper goroutine synchronization
	var wg sync.WaitGroup
	wg.Add(3) // Three goroutines: stream executor, stdin handler, stdout handler

	// Handle streams
	go func() {
		defer wg.Done()
		defer stderrWriter.Close()

		// Set up StreamOptions with TerminalSizeQueue
		streamOpts := remotecommand.StreamOptions{
			Stdin:             stdinReader,
			Stdout:            stdoutWriter,
			Stderr:            stderrWriter,
			Tty:               true,
			TerminalSizeQueue: tsQueue, // Add terminal size queue
		}

		log.Printf("Executing command in pod %s/%s, container %s", namespace, podName, containerName)
		if err := executor.StreamWithContext(ctx, streamOpts); err != nil {
			log.Printf("Stream error: %v", err)
			conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr,
				fmt.Sprintf("Stream error: %v", err)))
			cancel() // Cancel context to stop other goroutines
		}
	}()

	// Handle WebSocket messages (stdin)
	go func() {
		defer wg.Done()
		defer stdinWriter.Close()

		for {
			select {
			case <-ctx.Done():
				return
			default:
				msgType, data, err := conn.ReadMessage()
				if err != nil {
					if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						log.Printf("WebSocket read error: %v", err)
					}
					return
				}

				// Handle terminal resize messages
				if msgType == websocket.TextMessage {
					var resizeMsg struct {
						Type string `json:"type"`
						Cols uint16 `json:"cols"`
						Rows uint16 `json:"rows"`
					}
					if err := json.Unmarshal(data, &resizeMsg); err == nil && resizeMsg.Type == "resize" {
						select {
						case sizeChan <- remotecommand.TerminalSize{
							Width:  resizeMsg.Cols,
							Height: resizeMsg.Rows,
						}:
							// Resize message sent successfully
							continue
						case <-ctx.Done():
							return
						}
					}
				}

				// Treat as regular input
				log.Printf("Writing to stdinWriter...")
				if _, err := stdinWriter.Write(data); err != nil {
					if err != io.ErrClosedPipe {
						log.Printf("Error writing to stdin: %v", err)
					}
					return
				}
			}
		}
	}()

	// Forward stdout to WebSocket
	go func() {
		defer wg.Done()
		defer stdoutReader.Close()

		buf := make([]byte, 262144)
		for {
			select {
			case <-ctx.Done():
				return
			default:
				n, err := stdoutReader.Read(buf)
				if err != nil {
					if err != io.EOF && err != io.ErrClosedPipe {
						log.Printf("Error reading from stdout: %v", err)
					}
					return
				}
				log.Printf("Read %d bytes from stdout", n)
				err = conn.WriteMessage(websocket.TextMessage, buf[:n])
				if err != nil {
					if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						log.Printf("WebSocket write error: %v", err)
					}
					return
				}
				log.Printf("Wrote %d bytes from stdout", n)
			}
		}
	}()

	// Wait for all goroutines to complete
	wg.Wait()
}

func (a *App) handleEnvoyConfig(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	query := r.URL.Query()
	clusterName := query.Get("cluster")
	namespace := query.Get("namespace")
	podName := query.Get("pod")
	containerName := query.Get("container")

	commandParam := query.Get("command")
	if commandParam == "" || clusterName == "" || namespace == "" || podName == "" {
		http.Error(w, "Missing required parameters", http.StatusBadRequest)
		return
	}

	command := strings.Split(commandParam, ",")
	config, req, err := a.setupExecRequest(clusterName, namespace, podName, containerName, command, false)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	executor, err := remotecommand.NewSPDYExecutor(config, "POST", req.URL())
	if err != nil {
		http.Error(w, fmt.Sprintf("SPDY executor creation failed: %v", err), http.StatusInternalServerError)
		return
	}

	stdoutReader, stdoutWriter := io.Pipe()
	defer stdoutReader.Close()

	go func() {
		defer stdoutWriter.Close()
		err := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdout: stdoutWriter,
			Stderr: nil,
			Tty:    false,
		})
		if err != nil {
			log.Printf("Stream error: %v", err)
		}
	}()

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	io.Copy(w, stdoutReader)
}

func (a *App) GetEvents(clusterName, resourceName, namespace, name string) (string, error) {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return "", err
	}

	resourceInfo, gvr, err := a.findResourceInfo(clusterName, resourceName)
	if err != nil {
		return "", err
	}

	// Get the resource to extract its UID
	var obj *unstructured.Unstructured
	if resourceInfo.Namespaced {
		obj, err = clients.DynamicClient.Resource(gvr).Namespace(namespace).Get(context.Background(), name, metav1.GetOptions{})
	} else {
		obj, err = clients.DynamicClient.Resource(gvr).Get(context.Background(), name, metav1.GetOptions{})
	}
	if err != nil {
		return "", fmt.Errorf("failed to get resource: %w", err)
	}

	uid := extractString(extractMap(obj.Object, "metadata"), "uid")
	if uid == "" {
		return "", fmt.Errorf("failed to extract UID from resource metadata")
	}

	// Get events
	eventsGVR := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "events"}
	var events *unstructured.UnstructuredList

	if resourceInfo.Namespaced {
		events, err = clients.DynamicClient.Resource(eventsGVR).Namespace(namespace).List(context.Background(), metav1.ListOptions{
			FieldSelector: fmt.Sprintf("involvedObject.uid=%s", uid),
		})
	} else {
		events, err = clients.DynamicClient.Resource(eventsGVR).List(context.Background(), metav1.ListOptions{
			FieldSelector: fmt.Sprintf("involvedObject.uid=%s", uid),
		})
	}
	if err != nil {
		return "", fmt.Errorf("failed to list events: %w", err)
	}

	var eventList []map[string]string
	for _, event := range events.Items {
		eventData := event.Object

		from := extractString(eventData, "reportingComponent")
		if from == "" {
			if source := extractMap(eventData, "source"); len(source) > 0 {
				from = extractString(source, "component")
			}
		}

		eventList = append(eventList, map[string]string{
			"type":    extractString(eventData, "type"),
			"reason":  extractString(eventData, "reason"),
			"age":     getEventAge(eventData),
			"from":    from,
			"message": extractString(eventData, "message"),
		})
	}

	jsonData, err := json.MarshalIndent(eventList, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal events to JSON: %w", err)
	}
	return string(jsonData), nil
}

// Helper function to correctly calculate event age
func getEventAge(eventData map[string]interface{}) string {
	timeFields := []string{"eventTime", "lastTimestamp", "firstTimestamp"}

	for _, field := range timeFields {
		if timestamp, ok := eventData[field].(string); ok && timestamp != "" {
			eventTime, err := time.Parse(time.RFC3339, timestamp)
			if err == nil {
				return fmt.Sprintf("%s", time.Since(eventTime).Truncate(time.Minute))
			}
		}
	}
	return "unknown"
}

func (a *App) setupExecRequest(clusterName, namespace, podName, containerName string, command []string, tty bool) (*rest.Config, *rest.Request, error) {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return nil, nil, err
	}

	req := clients.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(namespace).
		Name(podName).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: containerName,
			Command:   command,
			Stdin:     tty,
			Stdout:    true,
			Stderr:    !tty,
			TTY:       tty,
		}, scheme.ParameterCodec)

	return clients.RestConfig, req, nil
}

// DependencyInfo represents dependency information for a resource
type DependencyInfo struct {
	Parents  []ResourceRef `json:"parents"`
	Children []ResourceRef `json:"children"`
}

// ResourceRef represents a reference to a Kubernetes resource
type ResourceRef struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	UID       string `json:"uid"`
}

// GetResourceDependencies retrieves the complete dependency chain for a specific resource
func (a *App) GetResourceDependencies(clusterName, apiResource, namespace, resourceName string) (*DependencyChain, error) {
	log.Printf("Getting dependencies for %s/%s in namespace %s, cluster %s", apiResource, resourceName, namespace, clusterName)

	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return nil, err
	}

	resourceInfo, gvr, err := a.findResourceInfo(clusterName, apiResource)
	if err != nil {
		return nil, err
	}

	// Get the target resource
	var obj *unstructured.Unstructured
	if resourceInfo.Namespaced {
		obj, err = clients.DynamicClient.Resource(gvr).Namespace(namespace).Get(context.Background(), resourceName, metav1.GetOptions{})
	} else {
		obj, err = clients.DynamicClient.Resource(gvr).Get(context.Background(), resourceName, metav1.GetOptions{})
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get resource: %w", err)
	}

	// Create current resource reference
	metadata := extractMap(obj.Object, "metadata")
	current := ResourceRef{
		Name:      resourceName,
		Kind:      obj.GetKind(),
		Namespace: namespace,
		UID:       extractString(metadata, "uid"),
	}

	log.Printf("Current resource: %+v", current)

	chain := &DependencyChain{
		Current:      current,
		Ancestors:    []ResourceRef{},
		Descendants:  []ResourceRef{},
		Applications: []ApplicationRef{},
	}

	// Build complete ancestor chain
	ancestors, err := a.buildAncestorChain(clients, obj, namespace)
	if err != nil {
		log.Printf("Error building ancestor chain: %v", err)
	} else {
		log.Printf("Found %d ancestors", len(ancestors))
		chain.Ancestors = ancestors
	}

	// Find descendants - используем разные стратегии в зависимости от типа ресурса
	var descendants []ResourceRef
	switch strings.ToLower(obj.GetKind()) {
	case "service":
		descendants, err = a.findServiceDependencies(clients, namespace, resourceName)
	default:
		descendants, err = a.findAllDescendants(clients, namespace, current.UID)
	}

	if err != nil {
		log.Printf("Error finding descendants: %v", err)
	} else {
		log.Printf("Found %d descendants", len(descendants))
		chain.Descendants = descendants
	}

	applications, err := a.findRelatedApplications(clients, obj, clusterName)
	if err != nil {
		log.Printf("Error finding related applications: %v", err)
	} else {
		chain.Applications = applications
	}

	return chain, nil
}

// findServiceDependencies finds resources related to a Service
func (a *App) findServiceDependencies(clients *KubeClients, namespace, serviceName string) ([]ResourceRef, error) {
	var dependencies []ResourceRef

	// Find Endpoints with the same name as the service
	endpointsGVR := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "endpoints"}
	endpoints, err := clients.DynamicClient.Resource(endpointsGVR).Namespace(namespace).Get(context.Background(), serviceName, metav1.GetOptions{})
	if err == nil {
		dependencies = append(dependencies, ResourceRef{
			Name:      endpoints.GetName(),
			Kind:      "Endpoints",
			Namespace: namespace,
			UID:       extractString(extractMap(endpoints.Object, "metadata"), "uid"),
		})
	}

	// Find EndpointSlices that reference this service
	endpointSlicesGVR := schema.GroupVersionResource{Group: "discovery.k8s.io", Version: "v1", Resource: "endpointslices"}
	endpointSlicesList, err := clients.DynamicClient.Resource(endpointSlicesGVR).Namespace(namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: fmt.Sprintf("kubernetes.io/service-name=%s", serviceName),
	})
	if err == nil {
		for _, slice := range endpointSlicesList.Items {
			dependencies = append(dependencies, ResourceRef{
				Name:      slice.GetName(),
				Kind:      "EndpointSlice",
				Namespace: namespace,
				UID:       extractString(extractMap(slice.Object, "metadata"), "uid"),
			})
		}
	}

	// Find Pods that match the service selector
	service, err := clients.DynamicClient.Resource(schema.GroupVersionResource{Group: "", Version: "v1", Resource: "services"}).
		Namespace(namespace).Get(context.Background(), serviceName, metav1.GetOptions{})
	if err == nil {
		spec := extractMap(service.Object, "spec")
		selector := extractMap(spec, "selector")

		if len(selector) > 0 {
			// Build label selector string
			var selectorParts []string
			for key, value := range selector {
				if valueStr, ok := value.(string); ok {
					selectorParts = append(selectorParts, fmt.Sprintf("%s=%s", key, valueStr))
				}
			}

			if len(selectorParts) > 0 {
				labelSelector := strings.Join(selectorParts, ",")
				podsGVR := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
				podsList, err := clients.DynamicClient.Resource(podsGVR).Namespace(namespace).List(context.Background(), metav1.ListOptions{
					LabelSelector: labelSelector,
				})
				if err == nil {
					for _, pod := range podsList.Items {
						dependencies = append(dependencies, ResourceRef{
							Name:      pod.GetName(),
							Kind:      "Pod",
							Namespace: namespace,
							UID:       extractString(extractMap(pod.Object, "metadata"), "uid"),
						})
					}
				}
			}
		}
	}

	log.Printf("Found %d service dependencies for %s", len(dependencies), serviceName)
	return dependencies, nil
}

// findChildResources finds all resources that have the given UID as an owner reference
func (a *App) findChildResources(clients *KubeClients, namespace, ownerUID string) ([]ResourceRef, error) {
	var children []ResourceRef

	// Get all API resources to search through
	discoveryClient := discovery.NewDiscoveryClient(clients.Clientset.RESTClient())
	_, apiGroupResources, err := discoveryClient.ServerGroupsAndResources()
	if err != nil {
		return children, err
	}

	// Search through common resource types that typically have owners
	commonResources := []string{"pods", "replicasets", "services", "configmaps", "secrets"}

	for _, groupResource := range apiGroupResources {
		for _, resource := range groupResource.APIResources {
			// Skip subresources and non-listable resources
			if strings.Contains(resource.Name, "/") || !slices.Contains(resource.Verbs, "list") {
				continue
			}

			// Only check common resources to avoid performance issues
			if !slices.Contains(commonResources, resource.Name) {
				continue
			}

			gv, err := schema.ParseGroupVersion(groupResource.GroupVersion)
			if err != nil {
				continue
			}

			gvr := schema.GroupVersionResource{
				Group:    gv.Group,
				Version:  gv.Version,
				Resource: resource.Name,
			}

			var list *unstructured.UnstructuredList
			if resource.Namespaced {
				list, err = clients.DynamicClient.Resource(gvr).Namespace(namespace).List(context.Background(), metav1.ListOptions{})
			} else {
				list, err = clients.DynamicClient.Resource(gvr).List(context.Background(), metav1.ListOptions{})
			}
			if err != nil {
				continue // Skip resources we can't list
			}

			// Check each resource for owner references
			for _, item := range list.Items {
				metadata := extractMap(item.Object, "metadata")
				if ownerRefs := extractSlice(metadata, "ownerReferences"); len(ownerRefs) > 0 {
					for _, ownerRef := range ownerRefs {
						if owner, ok := ownerRef.(map[string]interface{}); ok {
							if extractString(owner, "uid") == ownerUID {
								children = append(children, ResourceRef{
									Name:      item.GetName(),
									Kind:      item.GetKind(),
									Namespace: item.GetNamespace(),
									UID:       extractString(metadata, "uid"),
								})
								break // Found owner match, no need to check other owners
							}
						}
					}
				}
			}
		}
	}

	return children, nil
}

// DependencyChain represents the complete dependency chain
type DependencyChain struct {
	Ancestors    []ResourceRef    `json:"ancestors"`
	Current      ResourceRef      `json:"current"`
	Descendants  []ResourceRef    `json:"descendants"`
	Applications []ApplicationRef `json:"applications"` // Добавьте это поле
}

// buildAncestorChain recursively builds the complete chain of ancestors
func (a *App) buildAncestorChain(clients *KubeClients, obj *unstructured.Unstructured, namespace string) ([]ResourceRef, error) {
	var ancestors []ResourceRef

	metadata := extractMap(obj.Object, "metadata")
	ownerRefs := extractSlice(metadata, "ownerReferences")

	if len(ownerRefs) == 0 {
		return ancestors, nil
	}

	// Process each owner (usually there's only one, but handle multiple)
	for _, ownerRef := range ownerRefs {
		if owner, ok := ownerRef.(map[string]interface{}); ok {
			ownerName := extractString(owner, "name")
			ownerKind := extractString(owner, "kind")
			ownerAPIVersion := extractString(owner, "apiVersion")

			if ownerName == "" || ownerKind == "" {
				continue
			}

			// Create owner reference
			ownerResource := ResourceRef{
				Name:      ownerName,
				Kind:      ownerKind,
				Namespace: namespace,
				UID:       extractString(owner, "uid"),
			}

			// Try to get the owner object to continue the chain
			ownerObj, err := a.getResourceByKindAndName(clients, ownerKind, ownerAPIVersion, namespace, ownerName)
			if err != nil {
				log.Printf("Could not get owner %s/%s: %v", ownerKind, ownerName, err)
				// Add this owner even if we can't get its details
				ancestors = append([]ResourceRef{ownerResource}, ancestors...)
				continue
			}

			// Recursively get ancestors of this owner
			parentAncestors, err := a.buildAncestorChain(clients, ownerObj, namespace)
			if err != nil {
				log.Printf("Error getting ancestors for %s/%s: %v", ownerKind, ownerName, err)
			}

			// Build the chain: parent's ancestors + parent + current ancestors
			ancestors = append(parentAncestors, ownerResource)
		}
	}

	return ancestors, nil
}

// getResourceByKindAndName gets a resource by its kind, apiVersion, and name
func (a *App) getResourceByKindAndName(clients *KubeClients, kind, apiVersion, namespace, name string) (*unstructured.Unstructured, error) {
	// Parse the apiVersion to get group and version
	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil {
		return nil, fmt.Errorf("failed to parse apiVersion %s: %w", apiVersion, err)
	}

	// Convert kind to resource name (simple pluralization)
	resourceName := strings.ToLower(kind) + "s"

	// Handle special cases
	switch strings.ToLower(kind) {
	case "networkpolicy":
		resourceName = "networkpolicies"
	case "horizontalpodautoscaler":
		resourceName = "horizontalpodautoscalers"
	case "poddisruptionbudget":
		resourceName = "poddisruptionbudgets"
	}

	gvr := schema.GroupVersionResource{
		Group:    gv.Group,
		Version:  gv.Version,
		Resource: resourceName,
	}

	// Try to get the resource
	var obj *unstructured.Unstructured
	if namespace != "" {
		obj, err = clients.DynamicClient.Resource(gvr).Namespace(namespace).Get(context.Background(), name, metav1.GetOptions{})
	} else {
		obj, err = clients.DynamicClient.Resource(gvr).Get(context.Background(), name, metav1.GetOptions{})
	}

	return obj, err
}

// findAllDescendants finds all resources that have the given UID as an owner reference (recursively)
func (a *App) findAllDescendants(clients *KubeClients, namespace, ownerUID string) ([]ResourceRef, error) {
	visited := make(map[string]bool) // Prevent infinite loops

	return a.findDescendantsRecursive(clients, namespace, ownerUID, visited)
}

// findDescendantsRecursive recursively finds descendants
func (a *App) findDescendantsRecursive(clients *KubeClients, namespace, ownerUID string, visited map[string]bool) ([]ResourceRef, error) {
	if visited[ownerUID] {
		return []ResourceRef{}, nil
	}
	visited[ownerUID] = true

	var descendants []ResourceRef

	// Get direct children
	directChildren, err := a.findChildResources(clients, namespace, ownerUID)
	if err != nil {
		return descendants, err
	}

	// For each direct child, find its descendants too
	for _, child := range directChildren {
		descendants = append(descendants, child)

		// Recursively find descendants of this child
		childDescendants, err := a.findDescendantsRecursive(clients, namespace, child.UID, visited)
		if err != nil {
			log.Printf("Error finding descendants for %s: %v", child.Name, err)
			continue
		}
		descendants = append(descendants, childDescendants...)
	}

	return descendants, nil
}

// ApplicationRef represents an ArgoCD Application reference
type ApplicationRef struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Cluster   string `json:"cluster"` // Management cluster name
}

// getClusterAPIServerIP получает IP API сервера кластера через Kubernetes API (master ноды)
func (a *App) getClusterAPIServerIP(clusterName string) (string, error) {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return "", err
	}

	// Получаем список нод
	nodes, err := clients.Clientset.CoreV1().Nodes().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get nodes: %w", err)
	}

	// Ищем только master ноды
	for _, node := range nodes.Items {
		// Проверяем роли ноды
		labels := node.GetLabels()
		isMaster := labels["node-role.kubernetes.io/master"] == "" ||
			labels["node-role.kubernetes.io/control-plane"] == "" ||
			labels["kubernetes.io/role"] == "master"

		if !isMaster {
			continue // Пропускаем не-master ноды
		}

		// Получаем InternalIP master ноды
		for _, address := range node.Status.Addresses {
			if address.Type == "InternalIP" && address.Address != "" {
				return address.Address, nil
			}
		}
	}

	return "", fmt.Errorf("no master node with internal IP found for cluster %s", clusterName)
}

// extractIPFromServerURL извлекает IP адрес из server URL, резолвя hostname если нужно
func (a *App) extractIPFromServerURL(serverURL string) string {
	// Убираем протокол
	serverURL = strings.TrimPrefix(serverURL, "https://")
	serverURL = strings.TrimPrefix(serverURL, "http://")

	// Убираем порт
	host := serverURL
	if colonIndex := strings.LastIndex(serverURL, ":"); colonIndex != -1 {
		host = serverURL[:colonIndex]
	}

	// Проверяем что это уже IP адрес
	if net.ParseIP(host) != nil {
		log.Printf("Server URL contains IP address: %s", host)
		return host
	}

	// Обрабатываем in-cluster ссылки - возвращаем специальный маркер
	if host == "kubernetes.default.svc" || strings.HasSuffix(host, ".default.svc") {
		log.Printf("Found in-cluster server URL: %s", host)
		return "in-cluster"
	}

	// Это hostname, нужно резолвить
	log.Printf("Server URL contains hostname: %s, resolving...", host)
	ips, err := net.LookupIP(host)
	if err != nil {
		log.Printf("Failed to resolve hostname %s: %v", host, err)
		return ""
	}

	// Возвращаем первый IPv4 адрес
	for _, ip := range ips {
		if ipv4 := ip.To4(); ipv4 != nil {
			resolvedIP := ipv4.String()
			log.Printf("Resolved hostname %s to IP: %s", host, resolvedIP)
			return resolvedIP
		}
	}

	log.Printf("No IPv4 address found for hostname %s", host)
	return ""
}

// initializeManagementClusters инициализирует кэш management кластеров (выполняется один раз)
func (a *App) initializeManagementClusters() {
	a.mgmtClustersMutex.Lock()
	defer a.mgmtClustersMutex.Unlock()

	if a.mgmtClustersInitialized {
		return
	}

	log.Printf("Initializing management clusters cache...")

	kubeConfig, err := loadKubeConfig()
	if err != nil {
		log.Printf("Error loading kubeconfig: %v", err)
		a.mgmtClustersInitialized = true
		return
	}

	// Проверяем каждый кластер на наличие namespace argocd
	for clusterName := range kubeConfig.Contexts {
		if a.hasArgoCDNamespace(clusterName) {
			log.Printf("Cluster %s has argocd namespace, checking for cluster secrets...", clusterName)

			// Получаем список управляемых кластеров из ArgoCD секретов
			managedIPs := a.getManagedClusterIPs(clusterName)

			// Считаем management кластером только если есть cluster secrets
			if len(managedIPs) > 0 {
				a.managementClusters[clusterName] = managedIPs
				log.Printf("Management cluster %s manages %d clusters", clusterName, len(managedIPs))
			} else {
				log.Printf("Cluster %s has argocd namespace but no cluster secrets - not a management cluster", clusterName)
			}
		}
	}

	a.mgmtClustersInitialized = true
	log.Printf("Management clusters cache initialized. Found %d management clusters", len(a.managementClusters))
}

// hasArgoCDNamespace проверяет наличие namespace argocd в кластере
func (a *App) hasArgoCDNamespace(clusterName string) bool {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return false
	}

	_, err = clients.Clientset.CoreV1().Namespaces().Get(
		context.Background(), "argocd", metav1.GetOptions{})

	if err != nil {
		if errors.IsNotFound(err) {
			return false
		}
		// Если ошибка доступа (403), то namespace может существовать
		if statusErr, ok := err.(*errors.StatusError); ok && statusErr.Status().Code == 403 {
			return true
		}
		return false
	}

	return true
}

// getManagedClusterIPs получает список IP адресов управляемых кластеров из ArgoCD секретов
func (a *App) getManagedClusterIPs(mgmtCluster string) []string {
	var managedIPs []string

	clients, err := a.getKubeClients(mgmtCluster)
	if err != nil {
		log.Printf("Cannot connect to management cluster %s: %v", mgmtCluster, err)
		return managedIPs
	}

	// Получаем секреты кластеров по label selector
	secrets, err := clients.Clientset.CoreV1().Secrets("argocd").List(
		context.Background(), metav1.ListOptions{
			LabelSelector: "argocd.argoproj.io/secret-type=cluster",
		})

	if err != nil {
		log.Printf("Cannot get cluster secrets from %s/argocd: %v", mgmtCluster, err)
		return managedIPs
	}

	log.Printf("Found %d cluster secrets in management cluster %s", len(secrets.Items), mgmtCluster)

	// Извлекаем IP из каждого секрета
	for _, secret := range secrets.Items {
		serverURL, exists := secret.Data["server"]
		if !exists {
			log.Printf("Cluster secret %s has no 'server' field", secret.Name)
			continue
		}

		serverStr := string(serverURL)
		ip := a.extractIPFromServerURL(serverStr)
		if ip != "" {
			managedIPs = append(managedIPs, ip)
			log.Printf("Management cluster %s manages cluster with IP: %s (from secret %s)",
				mgmtCluster, ip, secret.Name)
		}
	}

	return managedIPs
}

// getManagementClusterForWorkload находит management кластер для указанного workload кластера
func (a *App) getManagementClusterForWorkload(workloadCluster string) string {
	// Инициализируем кэш если еще не сделали
	a.initializeManagementClusters()

	// Получаем все IP API серверов workload кластера
	workloadIPs, err := a.getClusterAPIServerIPs(workloadCluster)
	if err != nil {
		log.Printf("Cannot get API server IPs for cluster %s: %v", workloadCluster, err)
		return ""
	}

	if len(workloadIPs) == 0 {
		log.Printf("No API server IPs found for cluster %s", workloadCluster)
		return ""
	}

	log.Printf("Workload cluster %s has API server IPs: %v", workloadCluster, workloadIPs)

	// Ищем в кэше management кластер, который управляет любым из этих IP
	a.mgmtClustersMutex.RLock()
	defer a.mgmtClustersMutex.RUnlock()

	for mgmtCluster, managedIPs := range a.managementClusters {
		for _, managedIP := range managedIPs {
			// Проверяем каждый IP workload кластера
			for _, workloadIP := range workloadIPs {
				if managedIP == workloadIP {
					log.Printf("Found management cluster %s for workload cluster %s (matched IP: %s)",
						mgmtCluster, workloadCluster, workloadIP)
					return mgmtCluster
				}
			}
			// Проверяем in-cluster случай
			if managedIP == "in-cluster" && mgmtCluster == workloadCluster {
				log.Printf("Found in-cluster management for workload cluster %s", workloadCluster)
				return mgmtCluster
			}
		}
	}

	log.Printf("No management cluster found for workload cluster %s (IPs: %v)",
		workloadCluster, workloadIPs)
	return ""
}

// checkApplicationExists проверяет существование ArgoCD Application
func (a *App) checkApplicationExists(clusterName, namespace, appName string) (bool, error) {
	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return false, err
	}

	// ArgoCD Application GVR
	appGVR := schema.GroupVersionResource{
		Group:    "argoproj.io",
		Version:  "v1alpha1",
		Resource: "applications",
	}

	_, err = clients.DynamicClient.Resource(appGVR).Namespace(namespace).Get(
		context.Background(), appName, metav1.GetOptions{})

	if err != nil {
		if errors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}

	return true, nil
}

// findRelatedApplications ищет ArgoCD Applications связанные с ресурсом
func (a *App) findRelatedApplications(clients *KubeClients, obj *unstructured.Unstructured, clusterName string) ([]ApplicationRef, error) {
	var applications []ApplicationRef

	// Получаем метаданные ресурса
	metadata := extractMap(obj.Object, "metadata")
	labels := extractMap(metadata, "labels")

	// Ищем ArgoCD instance label
	instanceLabel, hasInstance := labels["argocd.argoproj.io/instance"]
	if !hasInstance {
		return applications, nil
	}

	instanceStr, ok := instanceLabel.(string)
	if !ok || instanceStr == "" {
		return applications, nil
	}

	log.Printf("Found ArgoCD instance label: %s", instanceStr)

	// Парсим instance label: обычно формат "namespace_appname"
	parts := strings.Split(instanceStr, "_")
	if len(parts) < 2 {
		log.Printf("Cannot parse ArgoCD instance label: %s", instanceStr)
		return applications, nil
	}

	appNamespace := parts[0]
	appName := strings.Join(parts[1:], "_") // На случай если в имени есть подчеркивания

	// Ищем подходящий management кластер
	managementCluster := a.getManagementClusterForWorkload(clusterName)
	if managementCluster == "" {
		log.Printf("No management cluster found for workload cluster %s", clusterName)
		return applications, nil
	}

	// Проверяем существование Application
	exists, err := a.checkApplicationExists(managementCluster, appNamespace, appName)
	if err != nil {
		log.Printf("Error checking application existence: %v", err)
		return applications, nil
	}

	if exists {
		applications = append(applications, ApplicationRef{
			Name:      appName,
			Namespace: appNamespace,
			Cluster:   managementCluster,
		})
		log.Printf("Found related Application: %s/%s in cluster %s", appNamespace, appName, managementCluster)
	}

	return applications, nil
}

// getClusterAPIServerIP получает все IP API серверов кластера (все master ноды)
func (a *App) getClusterAPIServerIPs(clusterName string) ([]string, error) {
	var masterIPs []string

	clients, err := a.getKubeClients(clusterName)
	if err != nil {
		return nil, err
	}

	// Получаем список нод
	nodes, err := clients.Clientset.CoreV1().Nodes().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get nodes: %w", err)
	}

	// Ищем все master ноды
	for _, node := range nodes.Items {
		// Проверяем роли ноды
		labels := node.GetLabels()
		_, hasMaster := labels["node-role.kubernetes.io/master"]
		_, hasControlPlane := labels["node-role.kubernetes.io/control-plane"]
		isMasterRole := labels["kubernetes.io/role"] == "master"

		isMaster := hasMaster || hasControlPlane || isMasterRole

		if !isMaster {
			continue // Пропускаем не-master ноды
		}

		// Получаем InternalIP master ноды
		for _, address := range node.Status.Addresses {
			if address.Type == "InternalIP" && address.Address != "" {
				masterIPs = append(masterIPs, address.Address)
				log.Printf("Found master node IP in cluster %s: %s", clusterName, address.Address)
			}
		}
	}

	if len(masterIPs) == 0 {
		return nil, fmt.Errorf("no master nodes with internal IP found for cluster %s", clusterName)
	}

	return masterIPs, nil
}
