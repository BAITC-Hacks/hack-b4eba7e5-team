import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import type { FilterSpecification, LayerSpecification, Map as MapInstance, Marker, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ApiError, getMapLayer, type District, type MapLayerId } from '../lib/api'
import { districtDisplayName } from '../lib/districts'
import { mapViewportOptions, observeMapSize } from '../lib/mapViewport'
import districtJson from '../data/districts.json'
import basemapJson from '../data/basemap.json'
import DistrictSelect from './DistrictSelect'

type MapDistrict = {
  id: string; name: string; case_district: boolean; osm_id: number
  label_point: [number, number]; bounds: [number, number, number, number]
}
const districtsGeo = districtJson as FeatureCollection<Polygon | MultiPolygon, MapDistrict>
const cityBounds: [number, number, number, number] = [71.217973, 50.857608, 71.785191, 51.35111]
const sourceId = 'case-districts'
const noSelection: FilterSpecification = ['==', ['get', 'id'], '']
type Overlay = { id: MapLayerId; name: string; color: string; dotClass: string; activeClass: string }
type OverlayStatus = { state: 'loading' | 'ready' | 'empty' | 'error'; message?: string; requestId?: string }
const overlays: Overlay[] = [
  { id: 'transport_stops', name: 'Остановки', color: '#2563eb', dotClass: 'bg-blue-600', activeClass: 'border-blue-500 bg-blue-50 text-blue-900' },
  { id: 'green_spaces', name: 'Зелёные зоны', color: '#16a34a', dotClass: 'bg-green-600', activeClass: 'border-green-500 bg-green-50 text-green-900' },
  { id: 'schools_kindergartens', name: 'Школы и детсады', color: '#9333ea', dotClass: 'bg-purple-600', activeClass: 'border-purple-500 bg-purple-50 text-purple-900' },
  { id: 'healthcare', name: 'Медучреждения', color: '#e11d48', dotClass: 'bg-rose-600', activeClass: 'border-rose-500 bg-rose-50 text-rose-900' },
  { id: 'road_safety_objects', name: 'Переходы и освещение', color: '#d97706', dotClass: 'bg-amber-600', activeClass: 'border-amber-500 bg-amber-50 text-amber-900' },
]

function contextLayerIds(id: MapLayerId) {
  return [`context-${id}-areas`, `context-${id}-lines`, `context-${id}-points`]
}

function showContext(map: MapInstance, overlay: Overlay, data: FeatureCollection) {
  const source = `context-${overlay.id}`
  const [areas, lines, points] = contextLayerIds(overlay.id)
  if (!map.getSource(source)) {
    map.addSource(source, { type: 'geojson', data })
    map.addLayer({ id: areas, type: 'fill', source, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': overlay.color, 'fill-opacity': 0.3 } })
    map.addLayer({ id: lines, type: 'line', source, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': overlay.color, 'line-width': 2, 'line-opacity': 0.85 } })
    map.addLayer({ id: points, type: 'circle', source, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': overlay.color, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 5], 'circle-opacity': 0.95, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } })
  }
  for (const id of [areas, lines, points]) map.setLayoutProperty(id, 'visibility', 'visible')
}

function viewPadding(toolbar: HTMLDivElement | null) {
  const toolbarHeight = toolbar && window.getComputedStyle(toolbar).position === 'absolute' ? toolbar.offsetHeight : 0
  return { top: toolbarHeight + 24, right: 32, bottom: 60, left: 32 }
}
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function districtLayers(selected: string): LayerSpecification[] {
  return [
    { id: 'case-fill', type: 'fill', source: sourceId, paint: { 'fill-color': '#64748b', 'fill-opacity': 0.035 } },
    { id: 'case-border', type: 'line', source: sourceId, paint: { 'line-color': '#64748b', 'line-width': 1.2, 'line-opacity': 0.45 } },
    // Фильтр заменяет выбор сразу: старый район не остаётся подсвеченным во время анимации камеры.
    { id: 'case-selected', type: 'fill', source: sourceId, filter: ['==', ['get', 'id'], selected], paint: { 'fill-color': '#0d9488', 'fill-opacity': 0.21 } },
    { id: 'case-selected-border', type: 'line', source: sourceId, filter: ['==', ['get', 'id'], selected], paint: { 'line-color': '#0f766e', 'line-width': 2.5 } },
    { id: 'case-hover', type: 'line', source: sourceId, filter: noSelection, paint: { 'line-color': '#475569', 'line-width': 1.8, 'line-opacity': 0.6 } },
  ]
}

function selection(map: MapInstance, id: string) {
  for (const layer of ['case-selected', 'case-selected-border']) {
    if (map.getLayer(layer)) map.setFilter(layer, ['==', ['get', 'id'], id])
  }
  if (map.getLayer('case-hover')) map.setFilter('case-hover', ['==', ['get', 'id'], ''])
}

function labelClass(selected: boolean, enabled: boolean) {
  return `pointer-events-none whitespace-nowrap rounded-none px-1.5 py-0.5 text-[11px] font-medium transition-colors duration-200 motion-reduce:transition-none ${selected ? 'bg-teal-800 text-white' : enabled ? 'bg-white text-slate-600' : 'bg-white text-slate-400'}`
}

export default function AstanaMap({ districtId, onDistrictChange, districts, renderSummary }: {
  districtId: string; onDistrictChange: (id: string) => void; districts: District[]
  renderSummary: (onClose: () => void) => ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const districtSelect = useRef<HTMLButtonElement>(null)
  const [popupDistrictId, setPopupDistrictId] = useState<string | null>(null)
  const labels = useRef<{ id: string; enabled: boolean; marker: Marker; text: HTMLDivElement }[]>([])
  const selectedRef = useRef(districtId)
  const pendingFocus = useRef<string | null>(null)
  const onChangeRef = useRef(onDistrictChange)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [tilesError, setTilesError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [selectedLayers, setSelectedLayers] = useState<MapLayerId[]>([])
  const [layerStatus, setLayerStatus] = useState<Partial<Record<MapLayerId, OverlayStatus>>>({})
  const [layerRetry, setLayerRetry] = useState(0)
  const cache = useRef(new Map<MapLayerId, FeatureCollection>())
  const requests = useRef(new Map<MapLayerId, AbortController>())
  const failedLayers = useRef(new Set<MapLayerId>())

  const closeSummary = useCallback(() => {
    setPopupDistrictId(null)
  }, [])

  function chooseDistrict(id: string) {
    onDistrictChange(id)
    setPopupDistrictId(id)
  }

  useEffect(() => { onChangeRef.current = onDistrictChange }, [onDistrictChange])

  useEffect(() => {
    if (!popupDistrictId) return
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape в модальных подсказках не должен закрывать карточку за ними.
      if (document.querySelector('dialog[open]')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSummary()
        districtSelect.current?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [popupDistrictId, closeSummary])

  useEffect(() => {
    const changed = selectedRef.current !== districtId
    selectedRef.current = districtId
    if (changed) pendingFocus.current = districtId
    const map = mapRef.current
    if (!map || !ready) return
    selection(map, districtId)
    for (const label of labels.current) label.text.className = labelClass(label.id === districtId, label.enabled)
    if (pendingFocus.current === districtId) {
      const feature = districtsGeo.features.find((f) => f.properties.id === districtId)
      if (feature) {
        map.stop()
        map.fitBounds(feature.properties.bounds, { padding: viewPadding(toolbar.current), duration: reducedMotion() ? 0 : 700, maxZoom: 12.4 })
        pendingFocus.current = null
      }
    }
  }, [districtId, ready])

  useEffect(() => {
    let cancelled = false
    let map: MapInstance | undefined
    let stopObservingSize: (() => void) | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const pendingRequests = requests.current
    const setup = async () => {
      try {
        const maplibre = await import('maplibre-gl')
        if (cancelled || !container.current) return
        // Районы находятся в сборке и доступны даже при недоступности внешних тайлов.
        const style: StyleSpecification = {
          ...(basemapJson as StyleSpecification),
          sources: { ...(basemapJson as StyleSpecification).sources, [sourceId]: { type: 'geojson', data: districtsGeo } },
          layers: [...(basemapJson as StyleSpecification).layers, ...districtLayers(selectedRef.current)],
        }
        const initialDistrict = districtsGeo.features.find((feature) => feature.properties.id === selectedRef.current)
        map = new maplibre.Map({
          container: container.current, style, bounds: initialDistrict?.properties.bounds ?? cityBounds,
          fitBoundsOptions: { padding: viewPadding(toolbar.current) },
          maxBounds: [[70.4, 50.5], [72.6, 51.9]], minZoom: 8.5, maxZoom: 16,
          dragRotate: false, pitchWithRotate: false, touchPitch: false,
          attributionControl: false, renderWorldCopies: false,
          ...mapViewportOptions,
        })
        mapRef.current = map
        map.touchZoomRotate.disableRotation()
        const mounted = map
        // Не ждём загрузки всех внешних тайлов, чтобы разрешить выбор районов.
        map.on('style.load', () => {
          if (cancelled) return
          selection(mounted, selectedRef.current)
          clearTimeout(watchdog)
          setReady(true)
        })
        map.on('error', () => { if (!cancelled) setTilesError(true) })
        watchdog = setTimeout(() => { if (!cancelled) { setTilesError(true); setReady(true) } }, 10000)
        for (const feature of districtsGeo.features) {
          const { id, name, label_point, case_district } = feature.properties
          const label = document.createElement('div')
          label.className = 'pointer-events-none'
          label.setAttribute('aria-hidden', 'true')
          const text = document.createElement('div')
          text.className = labelClass(id === selectedRef.current, case_district)
          text.textContent = case_district ? districtDisplayName(id, name) : `${name} · вне кейса`
          label.append(text)
          const marker = new maplibre.Marker({ element: label, anchor: 'center' }).setLngLat(label_point).addTo(map)
          labels.current.push({ id, enabled: case_district, marker, text })
        }
        map.on('click', (event) => {
          if (!mounted.getLayer('case-fill')) return
          const feature = mounted.queryRenderedFeatures(event.point, { layers: ['case-fill'] })
            .find((f) => f.properties.case_district === true)
          if (feature && typeof feature.properties.id === 'string') {
            onChangeRef.current(feature.properties.id)
            setPopupDistrictId(feature.properties.id)
          } else setPopupDistrictId(null)
        })
        map.on('mousemove', (event) => {
          if (!mounted.getLayer('case-fill')) return
          const feature = mounted.queryRenderedFeatures(event.point, { layers: ['case-fill'] })
            .find((f) => f.properties.case_district === true)
          const id = feature?.properties.id
          mounted.getCanvas().classList.toggle('cursor-pointer!', Boolean(id))
          mounted.setFilter('case-hover', ['==', ['get', 'id'], id && id !== selectedRef.current ? id : ''])
        })
        map.getCanvas().addEventListener('mouseleave', () => {
          if (mounted.getLayer('case-hover')) mounted.setFilter('case-hover', ['==', ['get', 'id'], ''])
        })
        stopObservingSize = observeMapSize(mounted, container.current)
      } catch {
        if (!cancelled) { setMapError(true); setReady(false) }
      }
    }
    void setup()
    return () => {
      cancelled = true
      clearTimeout(watchdog)
      stopObservingSize?.()
      for (const controller of pendingRequests.values()) controller.abort()
      pendingRequests.clear()
      labels.current.forEach((label) => label.marker.remove())
      labels.current = []
      map?.remove()
      mapRef.current = null
    }
  }, [retry])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getLayer('case-fill')) return
    for (const overlay of overlays) {
      const id = overlay.id
      if (!selectedLayers.includes(id)) {
        requests.current.get(id)?.abort()
        requests.current.delete(id)
        failedLayers.current.delete(id)
        for (const layerId of contextLayerIds(id)) {
          if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none')
        }
        continue
      }
      const cached = cache.current.get(id)
      if (cached) {
        showContext(map, overlay, cached)
        continue
      }
      if (requests.current.has(id) || failedLayers.current.has(id)) continue
      const controller = new AbortController()
      requests.current.set(id, controller)
      setLayerStatus((current) => ({ ...current, [id]: { state: 'loading' } }))
      // Каждый слой загружается независимо; устаревший ответ не может включить его снова.
      void getMapLayer(id, controller.signal).then((data) => {
        if (controller.signal.aborted || mapRef.current !== map) return
        cache.current.set(id, data)
        showContext(map, overlay, data)
        setLayerStatus((current) => ({ ...current, [id]: { state: data.features.length ? 'ready' : 'empty' } }))
      }).catch((error: unknown) => {
        if (controller.signal.aborted || mapRef.current !== map) return
        failedLayers.current.add(id)
        setLayerStatus((current) => ({ ...current, [id]: {
          state: 'error',
          message: error instanceof ApiError ? error.message : 'Не удалось загрузить слой',
          requestId: error instanceof ApiError ? error.requestId : undefined,
        } }))
      }).finally(() => {
        if (requests.current.get(id) === controller) requests.current.delete(id)
      })
    }
  }, [selectedLayers, ready, retry, layerRetry])

  function toggleLayer(id: MapLayerId) {
    setSelectedLayers((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  return (
    <div className="overflow-hidden rounded-none border border-slate-200 bg-white">
      <div className="@container relative isolate overflow-hidden bg-slate-100">
        <div ref={toolbar} className="relative z-20 flex flex-col items-start gap-2 p-3 @min-[600px]:pointer-events-none @min-[600px]:absolute @min-[600px]:left-3 @min-[600px]:right-[279px] @min-[600px]:top-3 @min-[600px]:p-0">
          <DistrictSelect buttonRef={districtSelect} id="map-district-select" label="Район" prefix="Район"
            value={districtId} onChange={chooseDistrict} className="pointer-events-auto w-[260px] max-w-full"
            options={districts.map((district) => ({ value: district.id, label: districtDisplayName(district.id, district.name) }))} />
          <div role="group" aria-label="Слои объектов" className="pointer-events-auto flex flex-wrap gap-1.5">
            {overlays.map((overlay) => {
              const active = selectedLayers.includes(overlay.id)
              const status = layerStatus[overlay.id]
              return <button key={overlay.id} type="button" aria-pressed={active} aria-busy={active && status?.state === 'loading'}
                disabled={!ready || mapError} onClick={() => toggleLayer(overlay.id)}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-none border px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150 disabled:opacity-50 motion-reduce:transition-none ${active ? overlay.activeClass : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'}`}>
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${overlay.dotClass} ${active && status?.state === 'loading' ? 'motion-safe:animate-pulse' : ''}`} />
                {overlay.name}
                <span aria-hidden="true" className="w-2 text-[10px]">{active ? status?.state === 'loading' ? '…' : status?.state === 'error' ? '!' : '✓' : ''}</span>
              </button>
            })}
          </div>
          <div role="status" className="pointer-events-auto empty:hidden">
            {overlays.filter((overlay) => selectedLayers.includes(overlay.id)).map((overlay) => {
              const status = layerStatus[overlay.id]
              if (status?.state !== 'error' && status?.state !== 'empty') return null
              return <p key={overlay.id} className="mb-1 border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600">
                {overlay.name}: {status.state === 'empty' ? 'нет объектов в данных' : status.message}
                {status.requestId && <span className="ml-1">#{status.requestId}</span>}
                {status.state === 'error' && <button type="button" aria-label={`Повторить загрузку: ${overlay.name}`} onClick={() => { failedLayers.current.delete(overlay.id); setLayerRetry((value) => value + 1) }} className="ml-2 font-medium text-slate-900 underline underline-offset-2">Повторить</button>}
              </p>
            })}
          </div>
        </div>
        <div className="relative h-[560px] sm:h-[600px] lg:h-[min(74vh,760px)] lg:min-h-[640px]">
          <div ref={container} className="h-full w-full" role="region" aria-label={`Карта Астаны. Выбран район ${districtDisplayName(districtId, districts.find((d) => d.id === districtId)?.name ?? '')}`} />
          {popupDistrictId === districtId && <div key={districtId} className="absolute right-3 top-3 z-10 origin-top-right scale-[0.85]">{renderSummary(closeSummary)}</div>}
          {!ready && !mapError && <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600 motion-safe:animate-pulse">Открываем карту…</span></div>}
          {mapError && <div className="absolute inset-x-0 bottom-0 top-48 grid place-content-center gap-3 p-8 text-center">
            <p className="text-sm text-slate-600">Карта недоступна в этом браузере.</p>
            <button type="button" onClick={() => { setPopupDistrictId(null); setMapError(false); setTilesError(false); setReady(false); setRetry((n) => n + 1) }} className="rounded-none border border-slate-300 bg-white px-4 py-2 text-sm text-teal-800">Повторить</button>
          </div>}
          {ready && !mapError && <>
            <div className="absolute bottom-3 right-3 flex flex-col divide-y divide-slate-200 border border-slate-300 bg-white">
              <button type="button" aria-label="Приблизить карту" onClick={() => mapRef.current?.zoomIn({ duration: reducedMotion() ? 0 : 250 })} className="h-10 w-10 rounded-none text-xl text-slate-600 transition-colors hover:bg-slate-100 motion-reduce:transition-none">+</button>
              <button type="button" aria-label="Отдалить карту" onClick={() => mapRef.current?.zoomOut({ duration: reducedMotion() ? 0 : 250 })} className="h-10 w-10 rounded-none text-xl text-slate-600 transition-colors hover:bg-slate-100 motion-reduce:transition-none">−</button>
            </div>
            <button type="button" onClick={() => { setPopupDistrictId(null); mapRef.current?.stop(); mapRef.current?.fitBounds(cityBounds, { padding: viewPadding(toolbar.current), duration: reducedMotion() ? 0 : 650 }) }} className="absolute bottom-3 left-3 min-h-10 rounded-none border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 motion-reduce:transition-none">Весь город</button>
            {tilesError && <p role="status" className="absolute bottom-16 left-3 max-w-48 border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">Часть подложки недоступна.</p>}
          </>}
        </div>
      </div>
      <div className="border-t border-slate-100 px-3 py-2 text-right text-[10px] text-slate-400">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">OpenStreetMap</a> · <a href="https://openfreemap.org/" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">OpenMapTiles</a>
      </div>
    </div>
  )
}
