import { useState } from 'react';
import type { SlideMeta } from '../types';

interface Props {
  meta: SlideMeta;
}

export function SlideInfoPanel({ meta }: Props) {
  const [propQuery, setPropQuery] = useState('');

  const mppX = meta.properties.get('openslide.mpp-x');
  const mppY = meta.properties.get('openslide.mpp-y');
  const vendor = meta.properties.get('openslide.vendor');
  const comment = meta.properties.get('openslide.comment');

  const allProps = [...meta.properties.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const q = propQuery.trim().toLowerCase();
  const filteredProps = q
    ? allProps.filter(
        ([k, v]) =>
          k.toLowerCase().includes(q) || v.toLowerCase().includes(q),
      )
    : allProps;

  return (
    <aside className="slide-info">

      {/* ── Overview ── */}
      <div className="slide-info__section">
        <h3 className="slide-info__section-title">Overview</h3>
        <dl className="slide-info__dl">
          <div className="slide-info__dl-row">
            <dt>Dimensions</dt>
            <dd>
              {meta.dimensions.width.toLocaleString()} ×{' '}
              {meta.dimensions.height.toLocaleString()} px
            </dd>
          </div>
          <div className="slide-info__dl-row">
            <dt>Pyramid levels</dt>
            <dd>{meta.levelCount}</dd>
          </div>
          {mppX && (
            <div className="slide-info__dl-row">
              <dt>MPP X</dt>
              <dd>{parseFloat(mppX).toFixed(4)} µm/px</dd>
            </div>
          )}
          {mppY && (
            <div className="slide-info__dl-row">
              <dt>MPP Y</dt>
              <dd>{parseFloat(mppY).toFixed(4)} µm/px</dd>
            </div>
          )}
          {vendor && (
            <div className="slide-info__dl-row">
              <dt>Vendor</dt>
              <dd>{vendor}</dd>
            </div>
          )}
          {comment && (
            <div className="slide-info__dl-row slide-info__dl-row--wrap">
              <dt>Comment</dt>
              <dd>{comment}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* ── Pyramid levels ── */}
      <div className="slide-info__section">
        <h3 className="slide-info__section-title">
          Pyramid ({meta.levelCount} {meta.levelCount === 1 ? 'level' : 'levels'})
        </h3>
        <table className="slide-info__table">
          <thead>
            <tr>
              <th>Level</th>
              <th>Width</th>
              <th>Height</th>
              <th>Downsample</th>
            </tr>
          </thead>
          <tbody>
            {meta.levelDimensions.map((dim, i) => (
              <tr key={i}>
                <td>{i}</td>
                <td>{dim.width.toLocaleString()}</td>
                <td>{dim.height.toLocaleString()}</td>
                <td>{meta.levelDownsamples[i].toFixed(2)}×</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Associated images ── */}
      {meta.associatedImages.length > 0 && (
        <div className="slide-info__section">
          <h3 className="slide-info__section-title">
            Associated Images ({meta.associatedImages.length})
          </h3>
          <div className="slide-info__images">
            {meta.associatedImages.map((img) => (
              <div key={img.name} className="slide-info__image-item">
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="slide-info__image"
                  title={`${img.width} × ${img.height} px`}
                />
                <span className="slide-info__image-label">{img.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── All properties — searchable, collapsible ── */}
      <details className="slide-info__section slide-info__section--collapsible">
        <summary className="slide-info__section-title slide-info__section-title--summary">
          All Properties ({allProps.length})
        </summary>

        <div className="slide-info__prop-search-wrap">
          <input
            type="search"
            value={propQuery}
            onChange={(e) => setPropQuery(e.target.value)}
            placeholder="Filter properties…"
            className="slide-info__prop-search"
            aria-label="Filter properties"
          />
          {q && (
            <span className="slide-info__prop-match">
              {filteredProps.length} / {allProps.length}
            </span>
          )}
        </div>

        <div className="slide-info__props-table-wrap">
          <table className="slide-info__table slide-info__table--props">
            <tbody>
              {filteredProps.map(([key, val]) => (
                <tr key={key}>
                  <td className="slide-info__prop-key" title={key}>{key}</td>
                  <td className="slide-info__prop-val" title={val}>{val}</td>
                </tr>
              ))}
              {filteredProps.length === 0 && (
                <tr>
                  <td colSpan={2} className="slide-info__prop-empty">
                    No properties match &ldquo;{propQuery}&rdquo;
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>

    </aside>
  );
}
