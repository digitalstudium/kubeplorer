export class Prompts {
  static getLogAnalysisPrompt(resourceName, containerName, logs) {
    return `Analyze these application logs and provide very short summary. This application is running on kubernetes, pod ${resourceName}, container ${containerName} . Don't ask to run any commands:\n${logs}`;
  }

  static getIstioProxyPrompt(logs) {
    return `Parse the provided Istio-proxy logs and output table of:

        Inbound Connections
        For each inbound request, list:

        Source IP

        HTTP method (e.g., GET/POST/PUT)

        Request path (e.g., /api/v1/data)

        HTTP status code

        Outbound Connections
        For each outbound request, list:

        Destination host/IP

        HTTP method

        Request path

        HTTP status code. Logs:\n${logs}`;
  }

  static getEventsAnalysisPrompt(apiResource, events) {
    return `These are events of kubernetes resource of kind ${apiResource}. Summaryze events, hint if any errors or warnings. Events: \n ${events}`;
  }
}
