import type { ContentDetails } from "../../plugins/emitters/contentIndex"
import {
  SimulationNodeDatum,
  SimulationLinkDatum,
  Simulation,
  forceSimulation,
  forceManyBody,
  forceCenter,
  forceLink,
  forceCollide,
  forceRadial,
  zoomIdentity,
  select,
  drag,
  zoom,
} from "d3"
import { Text, Graphics, Application, Container, Circle } from "pixi.js"
import { Group as TweenGroup, Tween as Tweened } from "@tweenjs/tween.js"
import { registerEscapeHandler, removeAllChildren, fetchCanonical } from "./util"
import {
  FullSlug,
  SimpleSlug,
  getFullSlug,
  resolveRelative,
  simplifySlug,
  normalizeRelativeURLs,
} from "../../util/path"
import { D3Config } from "../Graph"

type GraphicsInfo = {
  color: string
  gfx: Graphics
  alpha: number
  active: boolean
}

type NodeData = {
  id: SimpleSlug
  text: string
  tags: string[]
  sourcePath?: string
  isContentNode?: boolean
  isConceptTopicNode?: boolean
  isDatasetTopicNode?: boolean
  isLibraryTopicNode?: boolean
  isModelTopicNode?: boolean
  isPlatformTopicNode?: boolean
  isToolTopicNode?: boolean
} & SimulationNodeDatum

type SimpleLinkData = {
  source: SimpleSlug
  target: SimpleSlug
}

type LinkData = {
  source: NodeData
  target: NodeData
} & SimulationLinkDatum<NodeData>

type LinkRenderData = GraphicsInfo & {
  simulationData: LinkData
}

type NodeRenderData = GraphicsInfo & {
  simulationData: NodeData
  label: Text
}

const localStorageKey = "graph-visited"
function getVisited(): Set<SimpleSlug> {
  return new Set(JSON.parse(localStorage.getItem(localStorageKey) ?? "[]"))
}

function addToVisited(slug: SimpleSlug) {
  const visited = getVisited()
  visited.add(slug)
  localStorage.setItem(localStorageKey, JSON.stringify([...visited]))
}

type TweenNode = {
  update: (time: number) => void
  stop: () => void
}

async function renderGraph(graph: HTMLElement, fullSlug: FullSlug) {
  const slug = simplifySlug(fullSlug)
  const visited = getVisited()
  removeAllChildren(graph)

  let {
    drag: enableDrag,
    zoom: enableZoom,
    depth,
    scale,
    repelForce,
    centerForce,
    linkDistance,
    fontSize,
    opacityScale,
    removeTags,
    showTags,
    focusOnHover,
    enableRadial,
  } = JSON.parse(graph.dataset["cfg"]!) as D3Config

  const data: Map<SimpleSlug, ContentDetails> = new Map(
    Object.entries<ContentDetails>(await fetchData).map(([k, v]) => [
      simplifySlug(k as FullSlug),
      v,
    ]),
  )
  const links: SimpleLinkData[] = []
  const tags: SimpleSlug[] = []
  const validLinks = new Set(data.keys())

  const tweens = new Map<string, TweenNode>()
  for (const [source, details] of data.entries()) {
    const outgoing = details.links ?? []

    for (const dest of outgoing) {
      if (validLinks.has(dest)) {
        links.push({ source: source, target: dest })
      }
    }

    if (showTags) {
      const localTags = details.tags
        .filter((tag) => !removeTags.includes(tag))
        .map((tag) => simplifySlug(("tags/" + tag) as FullSlug))

      tags.push(...localTags.filter((tag) => !tags.includes(tag)))

      for (const tag of localTags) {
        links.push({ source: source, target: tag })
      }
    }
  }

  const neighbourhood = new Set<SimpleSlug>()
  const wl: (SimpleSlug | "__SENTINEL")[] = [slug, "__SENTINEL"]
  if (depth >= 0) {
    while (depth >= 0 && wl.length > 0) {
      // compute neighbours
      const cur = wl.shift()!
      if (cur === "__SENTINEL") {
        depth--
        wl.push("__SENTINEL")
      } else {
        neighbourhood.add(cur)
        const outgoing = links.filter((l) => l.source === cur)
        const incoming = links.filter((l) => l.target === cur)
        wl.push(...outgoing.map((l) => l.target), ...incoming.map((l) => l.source))
      }
    }
  } else {
    validLinks.forEach((id) => neighbourhood.add(id))
    if (showTags) tags.forEach((tag) => neighbourhood.add(tag))
  }

  const nodes = [...neighbourhood].map((url) => {
    const details = data.get(url)
    const text = url.startsWith("tags/") ? "#" + url.substring(5) : (details?.title ?? url)
    const filePath = details?.filePath
    const isContentNode =
      !!filePath && (filePath.startsWith("contents/") || filePath.includes("/contents/"))
    const isConceptTopicNode =
      !!filePath && (filePath.startsWith("Concept/") || filePath.includes("/Concept/"))
    const isDatasetTopicNode =
      !!filePath && (filePath.startsWith("Dataset/") || filePath.includes("/Dataset/"))
    const isLibraryTopicNode =
      !!filePath && (filePath.startsWith("Library/") || filePath.includes("/Library/"))
    const isModelTopicNode =
      !!filePath && (filePath.startsWith("Model/") || filePath.includes("/Model/"))
    const isPlatformTopicNode =
      !!filePath && (filePath.startsWith("Platform/") || filePath.includes("/Platform/"))
    const isToolTopicNode =
      !!filePath && (filePath.startsWith("Tool/") || filePath.includes("/Tool/"))

    return {
      id: url,
      text,
      tags: details?.tags ?? [],
      sourcePath: filePath,
      isContentNode,
      isConceptTopicNode,
      isDatasetTopicNode,
      isLibraryTopicNode,
      isModelTopicNode,
      isPlatformTopicNode,
      isToolTopicNode,
    }
  })
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const graphData: { nodes: NodeData[]; links: LinkData[] } = {
    nodes,
    links: links
      .filter((l) => neighbourhood.has(l.source) && neighbourhood.has(l.target))
      .map((l) => ({
        source: nodeMap.get(l.source)!,
        target: nodeMap.get(l.target)!,
      })),
  }

  // precompute link counts per node for radius calculation
  const linkCounts = new Map<string, number>()
  for (const l of graphData.links) {
    linkCounts.set(l.source.id, (linkCounts.get(l.source.id) ?? 0) + 1)
    linkCounts.set(l.target.id, (linkCounts.get(l.target.id) ?? 0) + 1)
  }

  const width = graph.offsetWidth
  const height = Math.max(graph.offsetHeight, 250)

  // we virtualize the simulation and use pixi to actually render it
  const nodeCount = graphData.nodes.length
  const collideIterations = nodeCount > 500 ? 1 : nodeCount > 200 ? 2 : 3
  const simulation: Simulation<NodeData, LinkData> = forceSimulation<NodeData>(graphData.nodes)
    .force("charge", forceManyBody().strength(-100 * repelForce))
    .force("center", forceCenter().strength(centerForce))
    .force("link", forceLink(graphData.links).distance(linkDistance))
    .force("collide", forceCollide<NodeData>((n) => nodeRadius(n)).iterations(collideIterations))

  const radius = (Math.min(width, height) / 2) * 0.8
  if (enableRadial) simulation.force("radial", forceRadial(radius).strength(0.2))

  // precompute style prop strings as pixi doesn't support css variables
  const cssVars = [
    "--secondary",
    "--tertiary",
    "--gray",
    "--light",
    "--lightgray",
    "--dark",
    "--darkgray",
    "--bodyFont",
    "--tagNode",
    "--tagNodeStroke",
    "--contentNode",
    "--contentNodeStroke",
    "--conceptTopicNode",
    "--datasetTopicNode",
    "--libraryTopicNode",
    "--modelTopicNode",
    "--platformTopicNode",
    "--toolTopicNode",
  ] as const
  const computedStyleMap = cssVars.reduce(
    (acc, key) => {
      acc[key] = getComputedStyle(document.documentElement).getPropertyValue(key)
      return acc
    },
    {} as Record<(typeof cssVars)[number], string>,
  )

  const tagFillColor = (computedStyleMap["--tagNode"] || computedStyleMap["--light"]).trim()
  const tagStrokeColor = (
    computedStyleMap["--tagNodeStroke"] || computedStyleMap["--tertiary"]
  ).trim()
  const contentFillColor = (
    computedStyleMap["--contentNode"] || computedStyleMap["--secondary"]
  ).trim()
  const contentStrokeColor = (
    computedStyleMap["--contentNodeStroke"] || computedStyleMap["--secondary"]
  ).trim()

  // calculate color
  const color = (d: NodeData) => {
    const isCurrent = d.id === slug
    if (isCurrent) {
      return computedStyleMap["--secondary"]
    } else if (d.id.startsWith("tags/")) {
      return computedStyleMap["--tertiary"]
    } else if (visited.has(d.id)) {
      return computedStyleMap["--tertiary"]
    } else if (d.isContentNode) {
      return contentFillColor
    } else if (d.isConceptTopicNode) {
      return computedStyleMap["--conceptTopicNode"]
    } else if (d.isDatasetTopicNode) {
      return computedStyleMap["--datasetTopicNode"]
    } else if (d.isLibraryTopicNode) {
      return computedStyleMap["--libraryTopicNode"]
    } else if (d.isModelTopicNode) {
      return computedStyleMap["--modelTopicNode"]
    } else if (d.isPlatformTopicNode) {
      return computedStyleMap["--platformTopicNode"]
    } else if (d.isToolTopicNode) {
      return computedStyleMap["--toolTopicNode"]
    } else {
      return computedStyleMap["--gray"]
    }
  }

  function nodeRadius(d: NodeData) {
    return 2 + Math.sqrt(linkCounts.get(d.id) ?? 0)
  }

  let hoveredNodeId: string | null = null
  let hoveredNeighbours: Set<string> = new Set()
  const linkRenderData: LinkRenderData[] = []
  const nodeRenderData: NodeRenderData[] = []
  function updateHoverInfo(newHoveredId: string | null) {
    hoveredNodeId = newHoveredId

    if (newHoveredId === null) {
      hoveredNeighbours = new Set()
      for (const n of nodeRenderData) {
        n.active = false
      }

      for (const l of linkRenderData) {
        l.active = false
      }
    } else {
      hoveredNeighbours = new Set()
      for (const l of linkRenderData) {
        const linkData = l.simulationData
        if (linkData.source.id === newHoveredId || linkData.target.id === newHoveredId) {
          hoveredNeighbours.add(linkData.source.id)
          hoveredNeighbours.add(linkData.target.id)
        }

        l.active = linkData.source.id === newHoveredId || linkData.target.id === newHoveredId
      }

      for (const n of nodeRenderData) {
        n.active = hoveredNeighbours.has(n.simulationData.id)
      }
    }
  }

  let dragStartTime = 0
  let dragStartPos = { x: 0, y: 0 }
  let dragging = false

  function renderLinks() {
    tweens.get("link")?.stop()
    const tweenGroup = new TweenGroup()

    for (const l of linkRenderData) {
      let alpha = 1

      // if we are hovering over a node, we want to highlight the immediate neighbours
      // with full alpha and the rest with default alpha
      if (hoveredNodeId) {
        alpha = l.active ? 1 : 0.2
      }

      l.color = l.active ? computedStyleMap["--gray"] : computedStyleMap["--lightgray"]
      tweenGroup.add(new Tweened<LinkRenderData>(l).to({ alpha }, 200))
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("link", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderLabels() {
    tweens.get("label")?.stop()
    const tweenGroup = new TweenGroup()

    const zoomK = currentTransform?.k ?? 1
    const defaultScale = 1 / (scale * zoomK)
    const activeScale = defaultScale * 1.1
    for (const n of nodeRenderData) {
      const nodeId = n.simulationData.id

      if (hoveredNodeId === nodeId) {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: 1,
              scale: { x: activeScale, y: activeScale },
            },
            100,
          ),
        )
      } else {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: n.label.alpha,
              scale: { x: defaultScale, y: defaultScale },
            },
            100,
          ),
        )
      }
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("label", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderNodes() {
    tweens.get("hover")?.stop()

    const tweenGroup = new TweenGroup()
    for (const n of nodeRenderData) {
      let alpha = 1

      // if we are hovering over a node, we want to highlight the immediate neighbours
      if (hoveredNodeId !== null && focusOnHover) {
        alpha = n.active ? 1 : 0.2
      }

      tweenGroup.add(new Tweened<Graphics>(n.gfx, tweenGroup).to({ alpha }, 200))
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("hover", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderPixiFromD3() {
    renderNodes()
    renderLinks()
    renderLabels()
    ensureAnimating()
  }

  // Popover preview on graph node hover (Alt/Option + hover)
  const domParser = new DOMParser()
  let activePopover: HTMLElement | null = null
  let popoverTimeout: ReturnType<typeof setTimeout> | null = null
  let altKeyDown = false
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Alt") {
      altKeyDown = true
      // trigger popover if already hovering a node
      if (hoveredNodeId && !activePopover) {
        const node = nodeRenderData.find((n) => n.simulationData.id === hoveredNodeId)
        if (node) {
          const rect = graph.getBoundingClientRect()
          const nodeX =
            (node.simulationData.x! + width / 2) * currentTransform.k +
            currentTransform.x +
            rect.left
          const nodeY =
            (node.simulationData.y! + height / 2) * currentTransform.k +
            currentTransform.y +
            rect.top
          clearGraphPopover()
          popoverTimeout = setTimeout(() => {
            showGraphPopover(hoveredNodeId as SimpleSlug, nodeX, nodeY)
          }, 300)
        }
      }
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Alt") altKeyDown = false
  }
  document.addEventListener("keydown", onKeyDown)
  document.addEventListener("keyup", onKeyUp)

  let hideTimeout: ReturnType<typeof setTimeout> | null = null

  function clearGraphPopover() {
    if (popoverTimeout) {
      clearTimeout(popoverTimeout)
      popoverTimeout = null
    }
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }
    if (activePopover) {
      activePopover.remove()
      activePopover = null
    }
  }

  function scheduleHidePopover() {
    if (hideTimeout) clearTimeout(hideTimeout)
    hideTimeout = setTimeout(() => {
      clearGraphPopover()
    }, 300)
  }

  function cancelHidePopover() {
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }
  }

  async function showGraphPopover(nodeId: SimpleSlug, clientX: number, clientY: number) {
    clearGraphPopover()
    const targetUrl = new URL(resolveRelative(fullSlug, nodeId), window.location.toString())
    targetUrl.hash = ""
    targetUrl.search = ""

    const popoverId = `graph-popover-${targetUrl.pathname}`
    const existing = document.getElementById(popoverId)
    if (existing) {
      existing.classList.add("active-popover")
      activePopover = existing
      positionGraphPopover(existing, clientX, clientY)
      return
    }

    const response = await fetchCanonical(targetUrl).catch(() => null)
    if (!response) return

    const contentType = response.headers.get("Content-Type")?.split(";")[0] ?? ""
    if (!contentType.startsWith("text/html")) return

    const contents = await response.text()
    const html = domParser.parseFromString(contents, "text/html")
    normalizeRelativeURLs(html, targetUrl)
    html.querySelectorAll("[id]").forEach((el) => {
      el.id = `graph-popover-internal-${el.id}`
    })
    const elts = [...html.getElementsByClassName("popover-hint")]
    if (elts.length === 0) return

    const popoverElement = document.createElement("div")
    popoverElement.id = popoverId
    popoverElement.classList.add("popover", "active-popover")
    const popoverInner = document.createElement("div")
    popoverInner.classList.add("popover-inner")
    popoverElement.appendChild(popoverInner)
    elts.forEach((elt) => popoverInner.appendChild(elt))

    popoverElement.addEventListener("mouseenter", cancelHidePopover)
    popoverElement.addEventListener("mouseleave", scheduleHidePopover)

    document.body.appendChild(popoverElement)
    activePopover = popoverElement
    positionGraphPopover(popoverElement, clientX, clientY)
  }

  function positionGraphPopover(el: HTMLElement, clientX: number, clientY: number) {
    const popoverWidth = 400
    const popoverMaxHeight = 300
    const margin = 10

    let x = clientX + margin
    let y = clientY + margin

    if (x + popoverWidth > window.innerWidth) {
      x = clientX - popoverWidth - margin
    }
    if (y + popoverMaxHeight > window.innerHeight) {
      y = clientY - popoverMaxHeight - margin
    }

    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }

  tweens.forEach((tween) => tween.stop())
  tweens.clear()

  const app = new Application()
  await app.init({
    width,
    height,
    antialias: true,
    autoStart: false,
    autoDensity: true,
    backgroundAlpha: 0,
    preference: "webgpu",
    resolution: window.devicePixelRatio,
    eventMode: "static",
  })
  graph.appendChild(app.canvas)

  const stage = app.stage
  stage.interactive = false

  const labelsContainer = new Container<Text>({ zIndex: 3, isRenderGroup: true })
  const nodesContainer = new Container<Graphics>({ zIndex: 2, isRenderGroup: true })
  const linkContainer = new Container<Graphics>({ zIndex: 1, isRenderGroup: true })
  stage.addChild(nodesContainer, labelsContainer, linkContainer)

  for (const n of graphData.nodes) {
    const nodeId = n.id

    const label = new Text({
      interactive: false,
      eventMode: "none",
      text: n.text,
      alpha: 0,
      anchor: { x: 0.5, y: 1.2 },
      style: {
        fontSize: fontSize * 15,
        fill: computedStyleMap["--dark"],
        fontFamily: computedStyleMap["--bodyFont"],
      },
      resolution: window.devicePixelRatio * 4,
    })
    label.scale.set(1 / scale)

    let oldLabelOpacity = 0
    const isTagNode = nodeId.startsWith("tags/")
    const gfx = new Graphics({
      interactive: true,
      label: nodeId,
      eventMode: "static",
      hitArea: new Circle(0, 0, nodeRadius(n)),
      cursor: "pointer",
    })
      .circle(0, 0, nodeRadius(n))
      .fill({ color: isTagNode ? tagFillColor : color(n) })
      .on("pointerover", (e) => {
        updateHoverInfo(e.target.label)
        oldLabelOpacity = label.alpha
        if (!dragging) {
          renderPixiFromD3()
        }
        // show popover only when Alt/Option key is held
        if (altKeyDown) {
          clearGraphPopover()
          const rect = graph.getBoundingClientRect()
          const nodeX = (n.x! + width / 2) * currentTransform.k + currentTransform.x + rect.left
          const nodeY = (n.y! + height / 2) * currentTransform.k + currentTransform.y + rect.top
          popoverTimeout = setTimeout(() => {
            showGraphPopover(nodeId as SimpleSlug, nodeX, nodeY)
          }, 300)
        }
      })
      .on("pointerleave", () => {
        updateHoverInfo(null)
        label.alpha = oldLabelOpacity
        if (!dragging) {
          renderPixiFromD3()
        }
        scheduleHidePopover()
      })

    if (isTagNode) {
      gfx.stroke({ width: 2, color: tagStrokeColor })
    } else if (n.isContentNode) {
      gfx.stroke({ width: 1.5, color: contentStrokeColor })
    }

    nodesContainer.addChild(gfx)
    labelsContainer.addChild(label)

    const nodeRenderDatum: NodeRenderData = {
      simulationData: n,
      gfx,
      label,
      color: color(n),
      alpha: 1,
      active: false,
    }

    nodeRenderData.push(nodeRenderDatum)
  }

  for (const l of graphData.links) {
    const gfx = new Graphics({ interactive: false, eventMode: "none" })
    linkContainer.addChild(gfx)

    const linkRenderDatum: LinkRenderData = {
      simulationData: l,
      gfx,
      color: computedStyleMap["--lightgray"],
      alpha: 1,
      active: false,
    }

    linkRenderData.push(linkRenderDatum)
  }

  // free intermediate build data no longer needed
  data.clear()
  nodeMap.clear()
  linkCounts.clear()
  neighbourhood.clear()
  links.length = 0
  tags.length = 0

  let currentTransform = zoomIdentity
  if (enableDrag) {
    select<HTMLCanvasElement, NodeData | undefined>(app.canvas).call(
      drag<HTMLCanvasElement, NodeData | undefined>()
        .container(() => app.canvas)
        .subject(() => graphData.nodes.find((n) => n.id === hoveredNodeId))
        .on("start", function dragstarted(event) {
          if (!event.active) simulation.alphaTarget(1).restart()
          event.subject.fx = event.subject.x
          event.subject.fy = event.subject.y
          event.subject.__initialDragPos = {
            x: event.subject.x,
            y: event.subject.y,
            fx: event.subject.fx,
            fy: event.subject.fy,
          }
          dragStartTime = Date.now()
          dragStartPos = { x: event.x, y: event.y }
          dragging = true
        })
        .on("drag", function dragged(event) {
          const initPos = event.subject.__initialDragPos
          event.subject.fx = initPos.x + (event.x - initPos.x) / currentTransform.k
          event.subject.fy = initPos.y + (event.y - initPos.y) / currentTransform.k
        })
        .on("end", function dragended(event) {
          if (!event.active) simulation.alphaTarget(0)
          event.subject.fx = null
          event.subject.fy = null
          dragging = false

          // only navigate if it looks like a click (short time + barely moved)
          const dx = event.x - dragStartPos.x
          const dy = event.y - dragStartPos.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (Date.now() - dragStartTime < 300 && dist < 5) {
            const node = graphData.nodes.find((n) => n.id === event.subject.id) as NodeData
            const targ = resolveRelative(fullSlug, node.id)
            window.spaNavigate(new URL(targ, window.location.toString()))
          }
        }),
    )
  } else {
    for (const node of nodeRenderData) {
      node.gfx.on("click", () => {
        const targ = resolveRelative(fullSlug, node.simulationData.id)
        window.spaNavigate(new URL(targ, window.location.toString()))
      })
    }
  }

  if (enableZoom) {
    select<HTMLCanvasElement, NodeData>(app.canvas).call(
      zoom<HTMLCanvasElement, NodeData>()
        .extent([
          [0, 0],
          [width, height],
        ])
        .scaleExtent([0.25, 4])
        .on("zoom", ({ transform }) => {
          currentTransform = transform
          stage.scale.set(transform.k, transform.k)
          stage.position.set(transform.x, transform.y)

          // zoom adjusts opacity of labels too
          const zoomScale = transform.k * opacityScale
          let scaleOpacity = Math.max((zoomScale - 1) / 3.75, 0)
          const activeNodes = nodeRenderData.filter((n) => n.active).flatMap((n) => n.label)

          // counter-scale labels so they keep a constant visual size
          const labelScale = 1 / (scale * transform.k)
          for (const label of labelsContainer.children) {
            label.scale.set(labelScale)
            if (!activeNodes.includes(label)) {
              label.alpha = scaleOpacity
            }
          }

          ensureAnimating()
        }),
    )
  }

  let stopAnimation = false
  let animationRunning = false

  function animate(time: number) {
    if (stopAnimation) {
      animationRunning = false
      return
    }

    for (const n of nodeRenderData) {
      const { x, y } = n.simulationData
      if (!x || !y) continue
      n.gfx.position.set(x + width / 2, y + height / 2)
      if (n.label) {
        n.label.position.set(x + width / 2, y + height / 2)
      }
    }

    for (const l of linkRenderData) {
      const linkData = l.simulationData
      l.gfx.clear()
      l.gfx.moveTo(linkData.source.x! + width / 2, linkData.source.y! + height / 2)
      l.gfx
        .lineTo(linkData.target.x! + width / 2, linkData.target.y! + height / 2)
        .stroke({ alpha: l.alpha, width: 1, color: l.color })
    }

    tweens.forEach((t) => t.update(time))
    app.renderer.render(stage)

    // stop the loop once simulation has cooled down and no tweens are active
    if (simulation.alpha() < simulation.alphaMin() && tweens.size === 0) {
      animationRunning = false
      return
    }

    requestAnimationFrame(animate)
  }

  function ensureAnimating() {
    if (!animationRunning && !stopAnimation) {
      animationRunning = true
      requestAnimationFrame(animate)
    }
  }

  // restart animation on simulation reheat
  simulation.on("tick", () => {
    ensureAnimating()
  })

  animationRunning = true
  requestAnimationFrame(animate)
  return () => {
    stopAnimation = true
    clearGraphPopover()
    document.removeEventListener("keydown", onKeyDown)
    document.removeEventListener("keyup", onKeyUp)
    app.destroy()
  }
}

let localGraphCleanups: (() => void)[] = []
let globalGraphCleanups: (() => void)[] = []

function cleanupLocalGraphs() {
  for (const cleanup of localGraphCleanups) {
    cleanup()
  }
  localGraphCleanups = []
}

function cleanupGlobalGraphs() {
  for (const cleanup of globalGraphCleanups) {
    cleanup()
  }
  globalGraphCleanups = []
}

document.addEventListener("nav", async (e: CustomEventMap["nav"]) => {
  const slug = e.detail.url
  addToVisited(simplifySlug(slug))

  async function renderLocalGraph() {
    cleanupLocalGraphs()
    const localGraphContainers = document.getElementsByClassName("graph-container")
    for (const container of localGraphContainers) {
      localGraphCleanups.push(await renderGraph(container as HTMLElement, slug))
    }
  }

  await renderLocalGraph()
  const handleThemeChange = () => {
    void renderLocalGraph()
  }

  document.addEventListener("themechange", handleThemeChange)
  window.addCleanup(() => {
    document.removeEventListener("themechange", handleThemeChange)
  })

  const containers = [...document.getElementsByClassName("global-graph-outer")] as HTMLElement[]
  async function renderGlobalGraph() {
    const slug = getFullSlug(window)
    for (const container of containers) {
      container.classList.add("active")
      const sidebar = container.closest(".sidebar") as HTMLElement
      if (sidebar) {
        sidebar.style.zIndex = "1"
      }

      const graphContainer = container.querySelector(".global-graph-container") as HTMLElement
      registerEscapeHandler(container, hideGlobalGraph)
      if (graphContainer) {
        globalGraphCleanups.push(await renderGraph(graphContainer, slug))
      }
    }
  }

  function hideGlobalGraph() {
    cleanupGlobalGraphs()
    for (const container of containers) {
      container.classList.remove("active")
      const sidebar = container.closest(".sidebar") as HTMLElement
      if (sidebar) {
        sidebar.style.zIndex = ""
      }
    }
  }

  async function shortcutHandler(e: HTMLElementEventMap["keydown"]) {
    if (e.key === "g" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      const anyGlobalGraphOpen = containers.some((container) =>
        container.classList.contains("active"),
      )
      anyGlobalGraphOpen ? hideGlobalGraph() : renderGlobalGraph()
    }
  }

  const containerIcons = document.getElementsByClassName("global-graph-icon")
  Array.from(containerIcons).forEach((icon) => {
    icon.addEventListener("click", renderGlobalGraph)
    window.addCleanup(() => icon.removeEventListener("click", renderGlobalGraph))
  })

  document.addEventListener("keydown", shortcutHandler)
  window.addCleanup(() => {
    document.removeEventListener("keydown", shortcutHandler)
    cleanupLocalGraphs()
    cleanupGlobalGraphs()
  })
})
