export namespace main {
	
	export class ApplicationRef {
	    name: string;
	    namespace: string;
	    cluster: string;
	
	    static createFrom(source: any = {}) {
	        return new ApplicationRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.cluster = source["cluster"];
	    }
	}
	export class ResourceRef {
	    name: string;
	    kind: string;
	    namespace?: string;
	    uid: string;
	
	    static createFrom(source: any = {}) {
	        return new ResourceRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.namespace = source["namespace"];
	        this.uid = source["uid"];
	    }
	}
	export class DependencyChain {
	    ancestors: ResourceRef[];
	    current: ResourceRef;
	    descendants: ResourceRef[];
	    applications: ApplicationRef[];
	
	    static createFrom(source: any = {}) {
	        return new DependencyChain(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ancestors = this.convertValues(source["ancestors"], ResourceRef);
	        this.current = this.convertValues(source["current"], ResourceRef);
	        this.descendants = this.convertValues(source["descendants"], ResourceRef);
	        this.applications = this.convertValues(source["applications"], ApplicationRef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

