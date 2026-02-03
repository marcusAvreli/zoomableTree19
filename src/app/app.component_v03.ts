
import {
  Component,
  ElementRef,
  OnInit,
  ViewChild
} from '@angular/core';
import { LazyOrgChart } from './lazy';
import { Observable, of, firstValueFrom } from 'rxjs';
import { delay } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  template: `
    <input #q placeholder="Search node" />
    <button (click)="searchNode(q.value)">Search</button>
    <div #chartContainer class="chart-container"></div>
  `
})
export class AppComponent implements OnInit {
  @ViewChild('chartContainer', { static: true })
  chartContainer!: ElementRef;

  chart = new LazyOrgChart();

  private cache = new Map<string, any[]>();      // parentId → children
  private nodeMap = new Map<string, any>();      // id → node
  private cachedEdgeDepths = new Map<string, number>();
  private expandedOnce = new Set<string>();
  private highlightedNodeIds = new Set<string>();
private searchScope = new Set<string>();
  private childOrder = new Map<string, number>(); // track registration order
  private orderCounter = 0;

  private highlightTimeout: any = null;

  /* ---------------- Repository ---------------- */
  repository = {
    get: (url: string): Observable<any[]> => {
		console.log("repository","get");
      const parentId = url.split('/').pop();
      return of(this.ALL.filter(n => n.parentId === parentId)).pipe(delay(200));
    },
 
	
	search: (term: string): Observable<any[]> => {
		console.log("repository","search");
  term = term.toLowerCase();
  const matches = this.ALL.filter(n => n.firstName?.toLowerCase().includes(term));
  return of(matches).pipe(delay(300));
}
  };

  /* ---------------- Mock Data ---------------- */
  private ALL = [
    { id: '1', name: 'Child 1', firstName:'test1', parentId: 'root', hasChildren: true },
    { id: '2', name: 'Child 2', firstName:'test2', parentId: 'root', hasChildren: true },
    { id: '3', name: 'Child 3', firstName:'test2', parentId: '1', hasChildren: false },
    { id: '4', name: 'Child 4', firstName:'test1', parentId: '1', hasChildren: false },
    { id: '5', name: 'Child 5', firstName:'test4', parentId: '1', hasChildren: true },
    { id: '6', name: 'Child 6', firstName:'test4', parentId: '5', hasChildren: false },
    { id: '7', name: 'Child 7', firstName:'test1', parentId: '2', hasChildren: false },
    { id: '8', name: 'Child 8', firstName:'test2', parentId: '2', hasChildren: true },
    { id: '9', name: 'Child 9', firstName:'test1', parentId: '8', hasChildren: false },
    { id: '10', name: 'Child 10', firstName:'test2', parentId: '8', hasChildren: false },
	{ id: '11', name: 'Child 11', firstName:'test2', parentId: 'root', hasChildren: true },
	{ id: '12', name: 'Child 12', firstName:'test21', parentId: '11', hasChildren: false },
	{ id: '13', name: 'Child 13', firstName:'test21', parentId: '11', hasChildren: false },
	{ id: '14', name: 'Child 14', firstName:'test23', parentId: '11', hasChildren: false }
  ];

  /* ---------------- Init ---------------- */
  ngOnInit() {
    const root = {
      id: 'root',
      parentId: null,
      name: 'Root',
      hasChildren: true,
      _expanded: true,
      _loaded: true
    };

    this.nodeMap.set('root', root);

    this.repository.get('/api/nodes/root').subscribe(nodes => {
      nodes.forEach(n => this.registerNode(n));
      this.cache.set('root', nodes);
      this.recomputeCachedEdgeDepths();
      this.renderChart();
    });
  }

  /* ---------------- Chart ---------------- */
  renderChart() {
    this.chart
      ['container'](this.chartContainer.nativeElement)
      .data([this.nodeMap.get('root')])
      .nodeId((d: any) => d.id)
      .parentNodeId((d: any) => d.parentId)
      .hasChildren((d: any) => d.hasChildren)
      .loadChildren(async (d: any) => {
        if (this.cache.has(d.id)) return this.cache.get(d.id)!;

        const children = await firstValueFrom(
          this.repository.get(`/api/nodes/${d.id}`)
        );

        children.forEach(c => this.registerNode(c));
        this.cache.set(d.id, children);
        this.recomputeCachedEdgeDepths();
        return children.sort((a,b) => a._order - b._order); // 🔥 preserve order
      })
      .nodeContent((d: any) => {
        const data = d.data;
        const highlight = this.highlightedNodeIds.has(data.id);

        return `
          <div style="
            padding:10px;
            height:100%;
            border:2px solid ${highlight ? 'orange' : '#ccc'};
            background:${highlight ? '#fff8dc' : 'white'};
            border-radius:4px;
          ">
            <strong>${data.name}</strong>
          </div>
        `;
      })
      .render();
  }

  /* ---------------- Search ---------------- */
 /** 🔥 SEARCH nodes efficiently with LCA */
async searchNode(term: string) {
  term = term.trim().toLowerCase();
  if (!term) return;

    const depth = this.getMaxCachedDepth();

  const matches = await firstValueFrom(this.repository.search(term));
  console.log("searchNode:",matches, " depth:",depth);
  if (!matches.length) return alert('Not found');


for (const node of matches) {
  let cur: any = node;

  while (cur) {
    // register current node if not already
    if (!this.nodeMap.has(cur.id)) this.registerNode(cur);

    // stop if no parent
    if (!cur.parentId) break;

    // check if parent is already registered
    let parent = this.nodeMap.get(cur.parentId);

    // if not, fetch from repository
    if (!parent) {
      const parents = await firstValueFrom(
        this.repository.get(`/api/nodes/${cur.parentId}`)
      );
      if (!parents || !parents.length) break;

      parent = parents[0];
      this.registerNode(parent);
    }

    // move up
    cur = parent;
  }
}

  /* 🔥 BUILD SEARCH SCOPE */
  this.searchScope.clear();

  for (const match of matches) {
  let cur: any = match;

  while (cur) {
    // include the node itself
    this.searchScope.add(cur.id);

    // get siblings from cache or repository
    let siblings = this.cache.get(cur.parentId);
    if (!siblings) {
      const children = await firstValueFrom(
        this.repository.get(`/api/nodes/${cur.parentId}`)
      );
      if (children && children.length) {
        children.forEach(c => this.registerNode(c));
        this.cache.set(cur.parentId, children);
        siblings = children;
      } else {
        siblings = [];
      }
    }

    siblings.forEach(s => this.searchScope.add(s.id));

    // move to parent
    if (!cur.parentId) break;
    let parent = this.nodeMap.get(cur.parentId);

    // fetch parent if missing
    if (!parent) {
      const parents = await firstValueFrom(
        this.repository.get(`/api/nodes/${cur.parentId}`)
      );
      if (!parents || !parents.length) break;
      parent = parents[0];
      this.registerNode(parent);
    }

    cur = parent;
  }
}


  this.highlightedNodeIds.clear();
  matches.forEach(m => this.highlightedNodeIds.add(m.id));
//this.buildSearchScope(matches);
 console.log("searchScope188: ",this.searchScope, this.cache, " matches:",matches, " matches",matches);
  const ancestor = this.findCommonAncestor(matches);
  console.log("searchScope189: ",this.searchScope, this.cache, " matches:",matches,"ancestor: ",ancestor, " matches",matches);
const searchChildrenMap =
  this.buildSearchChildrenMap(this.searchScope);

this.addSubtreeInOrder(ancestor, searchChildrenMap);
console.log("searchNode:",matches, "NodeMap:", this.nodeMap, " this.searchScope:",this.searchScope, " ancestor:",ancestor, "this.cache:",this.cache);
  this.chart['setCentered'](matches[0].id).render();

  setTimeout(() => {
    this.highlightedNodeIds.clear();
    this.chart['render']();
  }, 2500);
}


private buildSearchChildrenMap(scope: Set<string>): Map<string, any[]> {
  const map = new Map<string, any[]>();

  for (const node of this.ALL) {
    if (!node.parentId) continue;

    // parent OR child must be in scope to preserve the path
    if (!scope.has(node.id) && !scope.has(node.parentId)) continue;

    if (!map.has(node.parentId)) {
      map.set(node.parentId, []);
    }

    map.get(node.parentId)!.push(node);
  }

  // keep ordering stable
  for (const arr of map.values()) {
    arr.sort((a, b) => (a._order ?? 0) - (b._order ?? 0));
  }

  return map;
}
/*
private buildSearchScope(matches: any[]) {
  this.searchScope.clear();
  const pathNodes = new Set<string>();

  // 1️⃣ collect matches + ancestors
  for (const node of matches) {
    let cur = node;
    while (cur) {
      pathNodes.add(cur.id);
      this.searchScope.add(cur.id);
      cur = this.nodeMap.get(cur.parentId) ??
            this.ALL.find(n => n.id === cur.parentId);
    }
  }

  // 2️⃣ add siblings for every path node
  for (const id of pathNodes) {
    const node = this.nodeMap.get(id);
    if (!node?.parentId) continue;

    const siblings =
      this.cache.get(node.parentId) ??
      this.ALL.filter(n => n.parentId === node.parentId);

    siblings.forEach(s => this.searchScope.add(s.id));
  }
}
*/
private buildSearchScope(matches: any[]) {
  this.searchScope.clear();

  const pathNodes = new Set<string>();

  // 1️⃣ collect matches + ancestors (ONLY from nodeMap)
  for (const node of matches) {
    let cur: any | undefined = node;

    while (cur) {
      pathNodes.add(cur.id);
      this.searchScope.add(cur.id);

      cur = cur.parentId
        ? this.nodeMap.get(cur.parentId)
        : undefined;
    }
  }

  // 2️⃣ add siblings using cache only
  for (const id of pathNodes) {
    const node = this.nodeMap.get(id);
    if (!node?.parentId) continue;

    const siblings = this.cache.get(node.parentId);
    if (!siblings) continue;

    for (const sib of siblings) {
      this.searchScope.add(sib.id);
    }
  }
}

  /** Register node & preserve order */
  private registerNode(node: any) {
    if (!this.childOrder.has(node.parentId)) this.childOrder.set(node.parentId, 0);

    node._order = this.childOrder.get(node.parentId)!;
    this.childOrder.set(node.parentId, node._order + 1);

    this.nodeMap.set(node.id, node);
  }

  private recomputeCachedEdgeDepths() {
    this.cachedEdgeDepths.clear();

    const visit = (n: any, d: number) => {
      const kids = this.cache.get(n.id);
      if (!kids || !kids.length) {
        this.cachedEdgeDepths.set(n.id, d);
        return;
      }
      kids.forEach(c => visit(c, d + 1));
    };

    visit(this.nodeMap.get('root'), 0);
  }
  
 
private findCommonAncestor(matches: any[]): any {
  if (!matches.length) return this.nodeMap.get('root');

  // build ancestor paths
  const paths = matches.map(n => {
    const path: any[] = [];
    let cur: any | undefined = n;
    while (cur) {
      path.unshift(cur);
      cur = this.nodeMap.get(cur.parentId);
    }
    return path;
  });

  // find logical LCA
  let lca = paths[0][0];
  for (let i = 0; i < paths[0].length; i++) {
    const candidate = paths[0][i];
    if (paths.every(p => p[i]?.id === candidate.id)) {
      lca = candidate;
    } else break;
  }

  // WALK UP to **highest ancestor present in chart**, fallback to root
  let cur: any = lca;
  let lastSafe = this.nodeMap.get('root'); // root is always safe

  while (cur) {
    // if parent exists in cache, consider cur safe
    if (!cur.parentId || this.cache.has(cur.parentId)) {
      lastSafe = cur;
    }

    cur = this.nodeMap.get(cur.parentId);
  }

  return lastSafe;
}


private addSubtreeInOrder(node: any, childrenMap: Map<string, any[]>) {
  if (!node) return;
  console.log("addSubtreeInOrder:","this.searchScope: ",this.searchScope, " node:",node.id, " childrenMap:", childrenMap);
  if (!this.searchScope.has(node.id)) return;
 console.log("addSubtreeInOrder:","checkPost1");
  if (!this.chart['hasNode']?.(node.id)) {
    this.chart.addNodes([node]);
  }
console.log("addSubtreeInOrder:","checkPost2");
  node._expanded = true;
  node._loaded = true;
  this.chart['setExpanded'](node.id);
console.log("addSubtreeInOrder:","checkPost3", node.id);
  const kids = childrenMap.get(node.id) ?? [];
  console.log("addSubtreeInOrder:","checkPost4", "kids:",kids, "childrenMap",childrenMap);
  for (const k of kids) {
    this.addSubtreeInOrder(k, childrenMap);
  }
  
}
  private isPathNode(id: string): boolean {
  return this.highlightedNodeIds.has(id) ||
         [...this.highlightedNodeIds].some(mid =>
           this.isAncestor(id, mid)
         );
}

private isAncestor(a: string, b: string): boolean {
  let cur = this.nodeMap.get(b);
  while (cur) {
    if (cur.parentId === a) return true;
    cur = this.nodeMap.get(cur.parentId);
  }
  return false;
}
private getMaxCachedDepth(): number {
  if (!this.cachedEdgeDepths.size) {
    this.recomputeCachedEdgeDepths();
  }
  return Math.max(...this.cachedEdgeDepths.values());
}
}