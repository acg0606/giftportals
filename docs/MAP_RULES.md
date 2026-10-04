# GiftPortals discovery atlas

The Story atlas is a lightweight DOM/SVG hierarchy with original illustrations. This view has no tile provider, map-image downloads or GPS tracking. Its cards are schematic: their shapes and positions are not administrative boundaries or a street map. Only the current layer is rendered. The small source catalog is bundled; no remote geography service is required for this view.

The optional v3 Geographic globe is a separate view with local Natural Earth imagery and explicitly enabled OpenStreetMap street tiles. Its public-coordinate markers lead only to authorized memories. Camera navigation never records a physical visit. [Geographic integration, provider terms and provenance](GODS_EYE_INTEGRATION.md) document that renderer; the hierarchy and discovery semantics below apply to both views.

## Geography and scope

The path is World → Brazil → São Paulo state → municipality → district/curated area → memory point. São Paulo and Santos are different municipalities. Perdizes and Jabaquara are official municipal districts; the Paulista cultural corridor is a curated grouping along an avenue, **not a district**. Santos has two selected points, without a detailed urban world. France → Île-de-France → Paris is an orientation path for a received-memory example, labeled outside the pilot. The atlas does not catalog all states, districts, streets, or countries. Missing coverage never proves an absence of visits.

Eight pilot POIs have verified primary-source names and addresses. Seven have a published point/reference anchor. Japan House has a verified address but its coordinate was not established; it is displayed schematically and omitted from the coordinate dropdown. TUCA's coordinate is the operator's approximate published map anchor, not a surveyed entrance. No guessed coordinate or invented polygon fills these gaps.

| Stable place ID | Place / parent | Primary source |
|---|---|---|
| `tuca` | TUCA Theatre / Perdizes district | [Operator location](https://www.teatrotuca.com.br/localizacao.html) |
| `centro-cultural-jabaquara` | Mãe Sylvia de Oxalá / Jabaquara district | [Municipal culture directory](https://prefeitura.sp.gov.br/web/cultura/w/servicos/541) |
| `sitio-da-ressaca` | Sítio da Ressaca / Jabaquara district | [Municipal museum](https://www.museudacidade.prefeitura.sp.gov.br/sitio-da-ressaca/) |
| `masp` | MASP / Paulista corridor | [Museum visitor page](https://masp.org.br/visite) |
| `casa-das-rosas` | Casa das Rosas / Paulista corridor | [State cultural directory](https://admin.sggd.sp.gov.br/sec_cultura/Equipamentos/museus/CASA_DAS_ROSAS) |
| `japan-house` | Japan House / Paulista corridor | [Operator visitor page](https://japanhousesp.com.br/visite/) |
| `museu-pele` | Pelé Museum / Valongo area, Santos | [Municipal tourism](https://turismosantos.com.br/pt-br/content/museu-pele-0) |
| `orquidario-santos` | Orchid Park / curated park area, Santos | [Municipal location](https://www.santos.sp.gov.br/?q=node/96635), [municipal point](https://www.turismosantos.com.br/en/node/20710) |

District status comes from the [municipal administrative-boundary source](https://prefeitura.sp.gov.br/web/licenciamento/w/servicos/341586). São Paulo POI coordinates come from the official [GeoSampa WFS](https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs?service=WFS&version=2.0.0&request=GetCapabilities): cultural space `40214`, museum points `40232`, `40276`, and `40300`, queried as EPSG:4326 and stored as latitude/longitude. Each record retains its direct feature/source URL in `src/map-data.ts`. This is sourced point data, not copied imagery.

Sources were checked September 30, 2026. Two conflicts were preserved instead of concealed: an IBRAM Pelé Museum coordinate pointed away from the municipal address, so the municipal tourism point was used; municipal sources disagree between José Menino and Marapé for Orchid Park, so its parent is explicitly a curated park area without an asserted neighborhood boundary. Opening hours are not maintained by the atlas; consult the venue before visiting.

## Three independent histories

`DiscoveryDTO.kind` defines the meaning. `physical` contributes a solid ● and a green/teal card; `memory` contributes a diamond ◇ portal; `wish` contributes an outlined ☆ star. A gray hatched card means **no physical visit is recorded**, not proof that the person never visited. Symbols, patterns, and text accompany color. A place can have all three record types independently.

The pure `aggregateDiscovery(records, ownerId)` function computes each parent from its current descendant records. A physical visit to TUCA colors TUCA, Perdizes, São Paulo municipality, São Paulo state, Brazil, and World. It never colors Jabaquara, Paulista, Santos, or other siblings. Deleting the last physical record decolors its ancestors; editing the location moves the contribution on the next update. Duplicate visits count a distinct point once. Different memories at one point retain their separate memory count. No exploration percentage is invented.

Receiving Paris contributes a memory portal through France, without a physical visit. Opening a world or memory also creates no visit. A physical visit requires the user's explicit manual confirmation or an independently authorized backend flow. The required fictional fixture has TUCA/Perdizes and Pelé Museum/Santos physically visited, Jabaquara without a physical visit, MASP wished for, and Paris received through a memory. It is never silently assigned to a real user.

## Integration and permissions

```ts
import { mountDiscoveryMap } from './map';
import './map.css';

const atlas = mountDiscoveryMap(host, {
  ownerId: world.user.id,
  ownerName: world.user.displayName,
  demo: world.user.demo,
  memories: world.memories,
  discoveries: world.discoveries,
  canEdit: true,
  onOpenMemory: openAuthorizedMemory,
  onWishlist: persistWishlistThenRefreshWorld,
  onVisitChange: persistPhysicalVisitThenRefreshWorld,
});
// After an edit/delete/refresh, call atlas.update(newOptions).
// Before leaving the view, call atlas.destroy().
```

The component accepts structurally compatible backend DTOs. Only caller-provided authorized memories appear; it performs no broad fetch and reveals no friends-of-friends content. The caller must supply discoveries scoped to the displayed owner and must set `canEdit: false` when viewing another person's world. If records include `ownerId`, the pure aggregation also excludes mismatches. Callbacks must resolve only after the mutation succeeds and the caller updates the atlas from the refreshed world; failures remain recoverable. The map itself has no persistence and does not optimistically invent saved records. Switching owners resets navigation to World.

`pilotPlaces` and `getPilotPlace(id)` export verified latitude/longitude references and coordinate notes for the creation wizard. Location selection remains manual and correctable; a point reference is not GPS evidence. `FICTIONAL_DEMO_DISCOVERIES` is an opt-in fixture, not an implicit fallback for account data.

## Accessibility and verification

Navigation uses native buttons, a labeled breadcrumb list, a three-state legend, polite save announcements, at least 44-pixel control targets, and a responsive card layout. Keyboard users can drill into places and zoom out; headings receive focus after navigation. Reduced-motion settings disable card movement. Owner and fictional-demo labels remain visible. User text is inserted using `textContent`; only fixed original SVG paths use HTML insertion.

Run pure tests with the project's Node runtime:

```sh
node --experimental-strip-types --test tests/map-aggregation.test.mjs
```

Tests cover the required fictional hierarchy, no sibling propagation, received Paris, wishlist separation, removal and correction, owner isolation, duplicate counts, immutable inputs, unknown IDs/prototype names, catalog/source completeness, and cycle detection. Browser integration and production persistence are verified separately by the main application checks.
