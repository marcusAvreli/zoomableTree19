
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
      const parentId = url.split('/').pop();
      return of(this.ALL.filter(n => n.parentId === parentId)).pipe(delay(200));
    },
   /* search: (term: string, depth: number): Observable<any[]> => {
      term = term.toLowerCase();
      const matches = this.ALL.filter(n => n.firstName?.toLowerCase().includes(term));
      if (!matches.length) return of([]);

      const result = new Map<string, any>();
      const add = (n: any) => result.set(n.id, n);

      const collectAncestors = (node: any) => {
        let cur = node;
        while (cur) {
          add(cur);
          cur = this.ALL.find(n => n.id === cur.parentId);
        }
      };

      const collectDescendants = (node: any, d: number) => {
        if (d < 0) return;
        const children = this.ALL.filter(n => n.parentId === node.id);
        for (const c of children) {
          add(c);
          collectDescendants(c, d - 1);
        }
      };
		console.log("searchNode:", "repoMatches:",matches);
      for (const match of matches) {
        collectAncestors(match);
        collectDescendants(match, depth);
      }
	  
		console.log("searchNode:", "repoResult:",result);
      return of([...result.values()]).pipe(delay(300));
    }
	
	*/
	
	search: (term: string): Observable<any[]> => {
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
	   { id: '11', name: 'Child 11', firstName:'test2', parentId: 'root', hasChildren: false },
	      { id: '12', name: 'Child 12', firstName:'test21', parentId: '11', hasChildren: false }
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
/*
  const matches = this.ALL.filter(n =>
    n.firstName?.toLowerCase().includes(term)
  );
  */
    const depth = this.getMaxCachedDepth();

  const matches = await firstValueFrom(this.repository.search(term));
  console.log("searchNode:",matches, " depth:",depth);
  if (!matches.length) return alert('Not found');

  // register matches + ancestors
  for (const node of matches) {
    let cur: any = node;
    while (cur) {
      if (!this.nodeMap.has(cur.id)) this.registerNode(cur);
      cur =
        this.nodeMap.get(cur.parentId) ??
        this.ALL.find(n => n.id === cur.parentId);
    }
  }

  /* 🔥 BUILD SEARCH SCOPE */
  this.searchScope.clear();

  for (const match of matches) {
    let cur: any = match;

    while (cur) {
      // include the node itself
      this.searchScope.add(cur.id);

      // include siblings (brothers)
      const siblings = this.cache.get(cur.parentId) ?? [];
      siblings.forEach(s => this.searchScope.add(s.id));

      cur =
        this.nodeMap.get(cur.parentId) ??
        this.ALL.find(n => n.id === cur.parentId);
    }
  }

  this.highlightedNodeIds.clear();
  matches.forEach(m => this.highlightedNodeIds.add(m.id));
this.buildSearchScope(matches);

  const ancestor = this.findCommonAncestor(matches);
  console.log("searchNode:","ancestor: ",ancestor, " matches",matches);
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

  // attempt dynamic LCA
  const paths = matches.map(n => {
    const path: any[] = [];
    let cur: any | undefined = n;
    while (cur) {
      path.unshift(cur);
      cur = this.nodeMap.get(cur.parentId); // only use cached nodes
    }
    return path;
  });

  // find LCA from paths
  let ancestor = paths[0][0];
  for (let i = 0; i < paths[0].length; i++) {
    const candidate = paths[0][i];
    if (paths.every(p => p[i] && p[i].id === candidate.id)) {
      ancestor = candidate;
    } else break;
  }

  // if ancestor is partially cached, walk up to nearest cached parent
  while (!this.cache.has(ancestor.id) && ancestor.parentId) {
    ancestor = this.nodeMap.get(ancestor.parentId) ?? ancestor;
  }

  return ancestor;
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
console.log("addSubtreeInOrder:","checkPost3");
  const kids = childrenMap.get(node.id) ?? [];
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