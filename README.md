# Kubeplorer

A modern, browser-like GUI for Kubernetes cluster management built with Wails

## Features

- **Browser-Style Navigation**: Quickly switch between clusters and resources with an intuitive browser-like interface
- **Multi-Tab Support**: Manage multiple resources simultaneously with tabbed interface
- **Istio Integration**: Built-in support for Istio config dump
- **Interactive Terminal**: Direct pod access with integrated terminal functionality
- **Resource Management**: Comprehensive view/update/delete of Kubernetes resources including pods, services, deployments, and more
- **Namespace Organization**: Easy navigation between different namespaces
- **Real-time Status**: Monitor pod status, restarts, and age at a glance
- **Quick Actions**: Access common operations directly from the resource view

## Installation
Installation is available for Linux only so far.
```
curl -OL "https://github.com/digitalstudium/kubeplorer/releases/download/0.0.1/kubeplorer-linux-amd-64.bin" && sudo install ./kubeplorer-linux-amd-64.bin /usr/local/bin/kubeplorer && rm -f ./kubeplorer-linux-amd-64.bin
```

## License

GPL-3

---

Built with ❤️ using Wails
