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
	ctx context.Context
}

// NewApp creates a new App.
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go a.StartWebSocketServer()
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

// Updated functions:
func getClientset(clusterName string) (*kubernetes.Clientset, error) {
	restConfig, err := getClientConfig(clusterName)
	if err != nil {
		return nil, err
	}
	return kubernetes.NewForConfig(restConfig)
}

func getDynamicClient(clusterName string) (dynamic.Interface, error) {
	restConfig, err := getClientConfig(clusterName)
	if err != nil {
		return nil, err
	}
	return dynamic.NewForConfig(restConfig)
}

// TestClusterConnectivity attempts to list Nodes in a cluster to verify credentials and connectivity.
func (a *App) TestClusterConnectivity(clusterName string) bool {
	clientset, err := getClientset(clusterName)
	if err != nil {
		log.Printf("Connectivity test failed for %s: %v", clusterName, err)
		return false
	}

	// Try listing nodes as a connectivity test
	_, err = clientset.CoreV1().Nodes().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		// A 403 means we are at least authenticated, just not authorized to list nodes.
		if statusErr, ok := err.(*errors.StatusError); ok && statusErr.Status().Code == 403 {
			return true
		}
		// log.Printf("Error testing connectivity for %s: %v", clusterName, err)
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
	clientset, err := getClientset(clusterName)
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

	namespaces, err := clientset.CoreV1().Namespaces().List(context.Background(), metav1.ListOptions{})
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

	// Extract namespace names
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
	clientset, err := getClientset(clusterName)
	if err != nil {
		return nil, fmt.Errorf("failed to get Clientset: %w", err)
	}

	discoveryClient := discovery.NewDiscoveryClient(clientset.RESTClient())

	// Get API resources, allowing partial failures
	_, apiGroupResources, err := discoveryClient.ServerGroupsAndResources()
	if err != nil {
		// Handle partial discovery errors (like metrics server being down)
		if discoveryErr, ok := err.(*discovery.ErrGroupDiscoveryFailed); ok {
			// Log failed groups but continue with partial results
			log.Printf("Partial API group discovery failure: %v", discoveryErr.Groups)
		} else {
			return nil, fmt.Errorf("failed to retrieve API resources: %w", err)
		}
	}

	apiResourcesMap := make(APIResourceMap)

	for _, groupResource := range apiGroupResources {
		groupVersion := groupResource.GroupVersion

		// Exclude groups starting with "metrics.k8s.io" because it has "pods" and "nodes" resources. It's temporary workaround for deduplication
		if strings.HasPrefix(groupVersion, "metrics.k8s.io") {
			continue
		}

		for _, resource := range groupResource.APIResources {
			// Skip subresources (e.g., pods/status)
			if strings.Contains(resource.Name, "/") {
				continue
			}

			// Only include resources that support listing
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
func (a *App) GetResourcesInNamespace(clusterName, resourceName, namespace string) ([]interface{}, error) {
	apiResources, err := a.GetApiResources(clusterName)
	if err != nil {
		return nil, fmt.Errorf("failed to get API resources: %w", err)
	}

	// Attempt to find a match for the requested resource by name (singular/plural).
	var resourceInfo ResourceInfo
	found := false
	for _, resources := range apiResources {
		for _, r := range resources {
			if strings.EqualFold(r.Name, resourceName) { // Exact match
				resourceInfo = r
				found = true
				break
			}
		}
		if found {
			break
		}
	}

	dynamicClient, err := getDynamicClient(clusterName)
	if err != nil {
		return nil, err
	}

	gv, err := schema.ParseGroupVersion(resourceInfo.Version)
	if err != nil {
		return nil, fmt.Errorf("failed to parse group version %q: %w", resourceInfo.Version, err)
	}

	gvr := schema.GroupVersionResource{
		Group:    gv.Group,
		Version:  gv.Version,
		Resource: resourceInfo.Name,
	}

	var list *unstructured.UnstructuredList
	if resourceInfo.Namespaced {
		list, err = dynamicClient.Resource(gvr).Namespace(namespace).List(context.Background(), metav1.ListOptions{})
	} else {
		list, err = dynamicClient.Resource(gvr).List(context.Background(), metav1.ListOptions{})
	}
	if err != nil {
		return nil, fmt.Errorf("failed to list resources: %w", err)
	}

	var responses []interface{}
	for _, item := range list.Items {
		switch strings.ToLower(resourceInfo.Kind) {
		case "pod":
			pod := PodResponse{
				ResourceResponse: ResourceResponse{
					Name:     item.GetName(),
					Kind:     item.GetKind(),
					Metadata: extractMap(item.Object, "metadata"),
					Spec:     extractMap(item.Object, "spec"),
					Age:      formatAge(item.GetCreationTimestamp().Format(timeFormat)),
				},
				ReadyStatus: calculatePodReadyStatus(item),
			}
			status := extractMap(item.Object, "status")
			pod.Status = extractString(status, "phase", "N/A")
			pod.Restarts = 0

			// Container statuses
			// Check if the pod is terminating (based on deletionTimestamp in metadata)
			// Container statuses
			// Check if the pod is terminating (based on deletionTimestamp in metadata)
			if item.GetDeletionTimestamp() != nil {
				pod.Status = "Terminating"
			} else {
				if containerStatuses, ok := status["containerStatuses"].([]interface{}); ok {
					pod.Restarts = 0
					for _, cs := range containerStatuses {
						container, ok := cs.(map[string]interface{})
						if !ok {
							continue
						}
						// Sum restarts from all containers
						restartCount := extractInt64(container, "restartCount")
						pod.Restarts += int32(restartCount)

						// Check each container's state for waiting/terminated reasons
						state := extractMap(container, "state")
						if waiting := extractMap(state, "waiting"); len(waiting) > 0 {
							if reason := extractString(waiting, "reason", ""); reason != "" {
								pod.Status = reason
								break // Use the first waiting reason found
							}
						} else if terminated := extractMap(state, "terminated"); len(terminated) > 0 {
							if reason := extractString(terminated, "reason", ""); reason != "" {
								pod.Status = reason
								break // Use the first terminated reason found
							}
						}
					}
				}
			}

			// Calculate and set the ready status
			pod.ReadyStatus = calculatePodReadyStatus(item)
			// Collect container names (including init containers)
			spec := extractMap(item.Object, "spec")
			var containerNames []string

			// Init containers
			if initContainers, ok := spec["initContainers"].([]interface{}); ok {
				for _, initC := range initContainers {
					if m, ok := initC.(map[string]interface{}); ok {
						if name, ok := m["name"].(string); ok {
							containerNames = append(containerNames, name)
						}
					}
				}
			}

			// Regular containers
			if containers, ok := spec["containers"].([]interface{}); ok {
				for _, c := range containers {
					if m, ok := c.(map[string]interface{}); ok {
						if name, ok := m["name"].(string); ok {
							containerNames = append(containerNames, name)
						}
					}
				}
			}
			pod.Containers = containerNames
			responses = append(responses, pod)
		case "deployment":
			deployment, err := extractDeploymentFields(item)
			if err != nil {
				log.Printf("Error extracting deployment fields: %v", err)
				continue
			}
			responses = append(responses, deployment)
		default:
			resp := ResourceResponse{
				Name:     item.GetName(),
				Kind:     item.GetKind(),
				Metadata: extractMap(item.Object, "metadata"),
				Spec:     extractMap(item.Object, "spec"),
				Age:      formatAge(item.GetCreationTimestamp().Format(timeFormat)),
			}
			responses = append(responses, resp)
		}
	}
	return responses, nil
}

// GetResourceYAML retrieves the YAML representation of a specific resource
func (a *App) GetResourceYAML(clusterName string, resourceName string, namespace string, name string) (string, error) {
	apiResources, err := a.GetApiResources(clusterName)
	if err != nil {
		return "", fmt.Errorf("failed to get API resources: %w", err)
	}

	// Find the resource info
	var resourceInfo ResourceInfo
	found := false
	for _, resources := range apiResources {
		for _, r := range resources {
			if strings.EqualFold(r.Name, resourceName) { // Exact match first
				resourceInfo = r
				found = true
				break
			}
		}
		if found {
			break
		}
	}

	dynamicClient, err := getDynamicClient(clusterName)
	if err != nil {
		return "", err
	}

	gv, err := schema.ParseGroupVersion(resourceInfo.Version)
	if err != nil {
		return "", fmt.Errorf("failed to parse group version %q: %w", resourceInfo.Version, err)
	}

	gvr := schema.GroupVersionResource{
		Group:    gv.Group,
		Version:  gv.Version,
		Resource: resourceInfo.Name,
	}

	var obj *unstructured.Unstructured
	if resourceInfo.Namespaced {
		obj, err = dynamicClient.Resource(gvr).Namespace(namespace).Get(context.Background(), name, metav1.GetOptions{})
	} else {
		obj, err = dynamicClient.Resource(gvr).Get(context.Background(), name, metav1.GetOptions{})
	}
	if err != nil {
		return "", fmt.Errorf("failed to get resource: %w", err)
	}

	// Remove status and other runtime fields
	// delete(obj.Object, "status")
	metadata := obj.Object["metadata"].(map[string]interface{})
	delete(metadata, "creationTimestamp")
	delete(metadata, "resourceVersion")
	delete(metadata, "uid")
	delete(metadata, "managedFields")

	// Convert to YAML
	yamlBytes, err := yaml.Marshal(obj.Object)
	if err != nil {
		return "", fmt.Errorf("failed to encode resource as YAML: %w", err)
	}
	return string(yamlBytes), nil
}

// DeleteResource deletes a specified resource in the given cluster and namespace.
func (a *App) DeleteResource(clusterName, namespace, apiResource, name string) error {
	dynamicClient, err := getDynamicClient(clusterName)
	if err != nil {
		return fmt.Errorf("failed to get dynamic client: %w", err)
	}

	// Get the API resources map to find the correct GroupVersionResource (GVR)
	apiResources, err := a.GetApiResources(clusterName)
	if err != nil {
		return fmt.Errorf("failed to get API resources: %w", err)
	}

	var resourceInfo ResourceInfo
	found := false

	// Find the API resource information
	for _, resources := range apiResources {
		for _, r := range resources {
			if strings.EqualFold(r.Name, apiResource) { // Case-insensitive match
				resourceInfo = r
				found = true
				break
			}
		}
		if found {
			break
		}
	}

	if !found {
		return fmt.Errorf("resource type %q not found in API resources", apiResource)
	}

	// Parse group version
	gv, err := schema.ParseGroupVersion(resourceInfo.Version)
	if err != nil {
		return fmt.Errorf("failed to parse group version %q: %w", resourceInfo.Version, err)
	}

	// Construct GroupVersionResource (GVR)
	gvr := schema.GroupVersionResource{
		Group:    gv.Group,
		Version:  gv.Version,
		Resource: resourceInfo.Name,
	}

	// Delete the resource
	if resourceInfo.Namespaced {
		err = dynamicClient.Resource(gvr).Namespace(namespace).Delete(context.Background(), name, metav1.DeleteOptions{})
	} else {
		err = dynamicClient.Resource(gvr).Delete(context.Background(), name, metav1.DeleteOptions{})
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
	clientset, err := getClientset(clusterName)
	if err != nil {
		return "", fmt.Errorf("failed to get clientset: %w", err)
	}

	// Set up the log options
	logOptions := &corev1.PodLogOptions{
		Container: containerName,
		Follow:    false,
	}

	// Get the logs
	req := clientset.CoreV1().Pods(namespace).GetLogs(podName, logOptions)
	podLogs, err := req.Stream(context.Background())
	if err != nil {
		return "", fmt.Errorf("failed to get logs stream: %w", err)
	}
	defer podLogs.Close()

	// Read the logs
	buf := new(bytes.Buffer)
	_, err = io.Copy(buf, podLogs)
	if err != nil {
		return "", fmt.Errorf("failed to read logs stream: %w", err)
	}

	return buf.String(), nil
}

// Safely extract a map from an interface{}
func extractMap(obj map[string]interface{}, key string) map[string]interface{} {
	if val, ok := obj[key].(map[string]interface{}); ok {
		return val
	}
	return map[string]interface{}{}
}

// Safely extract a string from a map
func extractString(obj map[string]interface{}, key, defaultValue string) string {
	if val, ok := obj[key].(string); ok {
		return val
	}
	return defaultValue
}

// Safely extract an int64 from a map
func extractInt64(obj map[string]interface{}, key string) int64 {
	if val, ok := obj[key].(int64); ok {
		return val
	}
	return 0
}

// Safely extract a slice from a map
func extractSlice(obj map[string]interface{}, key string) []interface{} {
	if val, ok := obj[key].([]interface{}); ok {
		return val
	}
	return []interface{}{}
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
	// Decode the YAML content into an unstructured object
	obj := &unstructured.Unstructured{}
	err := yaml.Unmarshal([]byte(yamlContent), obj)
	if err != nil {
		return fmt.Errorf("failed to decode YAML: %w", err)
	}

	// Get the GVR (GroupVersionResource) from the object
	gvk := obj.GroupVersionKind()
	gvr := schema.GroupVersionResource{
		Group:    gvk.Group,
		Version:  gvk.Version,
		Resource: strings.ToLower(gvk.Kind) + "s", // Pluralize the kind
	}

	// Get the dynamic client for the cluster
	dynamicClient, err := getDynamicClient(clusterName)
	if err != nil {
		return fmt.Errorf("failed to get dynamic client: %w", err)
	}

	// Extract namespace from the object metadata, if present
	namespace := obj.GetNamespace()
	if namespace == "" {
		namespace = defaultNamespace
	}

	// Check if the resource already exists
	existingObj, err := dynamicClient.Resource(gvr).Namespace(namespace).Get(context.Background(), obj.GetName(), metav1.GetOptions{})
	if err != nil {
		if !errors.IsNotFound(err) {
			return fmt.Errorf("failed to check if resource exists: %w", err)
		}
		// Resource does not exist, create it
		_, err := dynamicClient.Resource(gvr).Namespace(namespace).Create(context.Background(), obj, metav1.CreateOptions{})
		if err != nil {
			return fmt.Errorf("failed to create resource: %w", err)
		}
		log.Printf("Resource %q of type %q created successfully in namespace %q in cluster %q", obj.GetName(), gvk.Kind, namespace, clusterName)
		return nil
	}

	// Resource exists, update it
	obj.SetResourceVersion(existingObj.GetResourceVersion()) // Required for updates
	_, err = dynamicClient.Resource(gvr).Namespace(namespace).Update(context.Background(), obj, metav1.UpdateOptions{})
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

	// Extract query parameters
	query := r.URL.Query()
	clusterName := query.Get("cluster")
	namespace := query.Get("namespace")
	podName := query.Get("pod")
	containerName := query.Get("container")

	// Optional command parameter
	commandParam := query.Get("command")
	var command []string
	if commandParam != "" {
		// Parse the command from the URL parameter
		command = strings.Split(commandParam, ",")
	} else {
		command = []string{"/bin/sh"}
	}

	log.Printf("Starting terminal session: cluster=%s, namespace=%s, pod=%s, container=%s, command=%v",
		clusterName, namespace, podName, containerName, command)

	// Input validation
	if clusterName == "" || namespace == "" || podName == "" || containerName == "" {
		errMsg := "Missing required parameters"
		log.Println(errMsg)
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, errMsg))
		return
	}

	// Get Kubernetes client configuration
	config, err := getClientConfig(clusterName)
	if err != nil {
		log.Printf("Error getting client config: %v", err)
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr,
			fmt.Sprintf("Error getting client config: %v", err)))
		return
	}

	// Create Kubernetes clientset
	clientset, err := getClientset(clusterName)
	if err != nil {
		log.Printf("Error creating clientset: %v", err)
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr,
			fmt.Sprintf("Error creating clientset: %v", err)))
		return
	}

	// Set up exec request
	req := clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(namespace).
		Name(podName).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: containerName,
			Command:   command,
			Stdin:     true,
			Stdout:    true,
			Stderr:    false,
			TTY:       true,
		}, scheme.ParameterCodec)

	log.Printf("Kubernetes API request URL: %s", req.URL().String())

	// Create SPDY executor
	executor, err := remotecommand.NewSPDYExecutor(config, "POST", req.URL())
	if err != nil {
		log.Printf("SPDY executor creation failed: %v", err)
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr,
			fmt.Sprintf("SPDY executor creation failed: %v", err)))
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

	// Extract query parameters
	query := r.URL.Query()
	clusterName := query.Get("cluster")
	namespace := query.Get("namespace")
	podName := query.Get("pod")
	containerName := query.Get("container")

	commandParam := query.Get("command")
	var command []string
	if commandParam != "" {
		// Parse the command from the URL parameter
		command = strings.Split(commandParam, ",")
	} else {
		return
	}

	if clusterName == "" || namespace == "" || podName == "" {
		http.Error(w, "Missing required parameters", http.StatusBadRequest)
		return
	}

	// Get Kubernetes client configuration
	config, err := getClientConfig(clusterName)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error getting client config: %v", err), http.StatusInternalServerError)
		return
	}

	// Create Kubernetes clientset
	clientset, err := getClientset(clusterName)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error creating clientset: %v", err), http.StatusInternalServerError)
		return
	}

	// Set up exec request
	req := clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(namespace).
		Name(podName).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: containerName,
			Command:   command,
			Stdin:     false,
			Stdout:    true,
			Stderr:    false,
			TTY:       false,
		}, scheme.ParameterCodec)

	// Create SPDY executor
	executor, err := remotecommand.NewSPDYExecutor(config, "POST", req.URL())
	if err != nil {
		http.Error(w, fmt.Sprintf("SPDY executor creation failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Stream output directly to the HTTP response
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

func (a *App) GetEvents(clusterName string, resourceName string, namespace string, name string) (string, error) {
	// Fetch API resources to locate the resource info
	apiResources, err := a.GetApiResources(clusterName)
	if err != nil {
		return "", fmt.Errorf("failed to get API resources: %w", err)
	}

	// Find the resource info
	var resourceInfo ResourceInfo
	found := false
	for _, resources := range apiResources {
		for _, r := range resources {
			if strings.EqualFold(r.Name, resourceName) { // Exact match first
				resourceInfo = r
				found = true
				break
			}
		}
		if found {
			break
		}
	}

	if !found {
		return "", fmt.Errorf("resource %q not found in API resources", resourceName)
	}

	// Create a dynamic client for the cluster
	dynamicClient, err := getDynamicClient(clusterName)
	if err != nil {
		return "", fmt.Errorf("failed to create dynamic client: %w", err)
	}

	// Parse the group and version of the resource
	gv, err := schema.ParseGroupVersion(resourceInfo.Version)
	if err != nil {
		return "", fmt.Errorf("failed to parse group version %q: %w", resourceInfo.Version, err)
	}

	// Construct the GroupVersionResource (GVR) for the resource
	gvr := schema.GroupVersionResource{
		Group:    gv.Group,
		Version:  gv.Version,
		Resource: resourceInfo.Name,
	}

	// Fetch the resource object to get its UID
	var obj *unstructured.Unstructured
	if resourceInfo.Namespaced {
		obj, err = dynamicClient.Resource(gvr).Namespace(namespace).Get(context.Background(), name, metav1.GetOptions{})
	} else {
		obj, err = dynamicClient.Resource(gvr).Get(context.Background(), name, metav1.GetOptions{})
	}

	if err != nil {
		return "", fmt.Errorf("failed to get resource: %w", err)
	}

	// Extract the UID of the resource
	metadata, ok := obj.Object["metadata"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("failed to extract metadata from resource")
	}
	uid, ok := metadata["uid"].(string)
	if !ok {
		return "", fmt.Errorf("failed to extract UID from resource metadata")
	}

	// Fetch events related to the resource
	eventsGVR := schema.GroupVersionResource{
		Group:    "",
		Version:  "v1",
		Resource: "events",
	}

	var events *unstructured.UnstructuredList
	if resourceInfo.Namespaced {
		events, err = dynamicClient.Resource(eventsGVR).Namespace(namespace).List(context.Background(), metav1.ListOptions{
			FieldSelector: fmt.Sprintf("involvedObject.uid=%s", uid),
		})
	} else {
		events, err = dynamicClient.Resource(eventsGVR).List(context.Background(), metav1.ListOptions{
			FieldSelector: fmt.Sprintf("involvedObject.uid=%s", uid),
		})
	}

	if err != nil {
		return "", fmt.Errorf("failed to list events: %w", err)
	}

	// Create a slice to hold event data
	var eventList []map[string]string

	for _, event := range events.Items {
		eventData := event.Object

		// Extract fields
		eventType := getStringField(eventData, "type")
		reason := getStringField(eventData, "reason")
		message := getStringField(eventData, "message")

		// Fixing the "From" field
		from := getStringField(eventData, "reportingComponent")
		if from == "<missing>" { // Fall back to older field
			if source, ok := eventData["source"].(map[string]interface{}); ok {
				from = getStringField(source, "component")
			}
		}

		// Fixing the "Age" field
		age := getEventAge(eventData)

		// Append event data to the slice
		eventList = append(eventList, map[string]string{
			"type":    eventType,
			"reason":  reason,
			"age":     age,
			"from":    from,
			"message": message,
		})
	}

	// Marshal the event list into JSON
	jsonData, err := json.MarshalIndent(eventList, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal events to JSON: %w", err)
	}

	return string(jsonData), nil
}

// Helper function to safely extract string fields
func getStringField(data map[string]interface{}, key string) string {
	value, ok := data[key].(string)
	if !ok {
		return "<missing>"
	}
	return value
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
