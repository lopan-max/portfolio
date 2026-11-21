import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import scrollama from 'https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm';

async function loadData() {
  const data = await d3.csv('loc.csv', (row) => ({
    ...row,
    line: Number(row.line),
    depth: Number(row.depth),
    length: Number(row.length),
    date: new Date(row.date + 'T00:00' + row.timezone),
    datetime: new Date(row.datetime),
  }));

  return data;
}

function processCommits(data) {
  return d3
    .groups(data, (d) => d.commit)
    .map(([commit, lines]) => {
      let first = lines[0];
      let { author, date, time, timezone, datetime } = first;

      let ret = {
        id: commit,
        url: 'https://github.com/lopan-max/portfolio/commit/' + commit,
        author,
        date,
        time,
        timezone,
        datetime,
        hourFrac: datetime.getHours() + datetime.getMinutes() / 60,
        totalLines: lines.length,
      };

      Object.defineProperty(ret, 'lines', {
        value: lines,
        writable: false,
        enumerable: false,
        configurable: false,
      });

      return ret;
    })
    .sort((a, b) => a.datetime - b.datetime);
}

function renderCommitInfo(data, commits) {
  const container = d3.select('#stats');
  container.selectAll('*').remove();

  const dl = container.append('dl').attr('class', 'stats');

  dl.append('dt').html('Total <abbr title="Lines of code">LOC</abbr>');
  dl.append('dd').text(data.length);

  dl.append('dt').text('Total commits');
  dl.append('dd').text(commits.length);

  dl.append('dt').text('Files');
  dl.append('dd').text(data.length ? d3.group(data, (d) => d.file).size : 0);

  const fileLengths = d3.rollups(
    data,
    (v) => d3.max(v, (d) => d.line),
    (d) => d.file,
  );
  const averageFileLength = d3.mean(fileLengths, (d) => d[1]);

  dl.append('dt').text('Average file length');
  dl.append('dd').text(
    Number.isFinite(averageFileLength)
      ? `${d3.format('.1f')(averageFileLength)} lines`
      : '—',
  );

  const longestFile = d3.greatest(fileLengths, (d) => d[1]);
  dl.append('dt').text('Longest file');
  dl.append('dd').text(
    longestFile ? `${displayPath(longestFile[0])} (${longestFile[1]} lines)` : '—',
  );

  const workByPeriod = d3.rollups(
    data,
    (v) => v.length,
    (d) => d.datetime.toLocaleString('en', { dayPeriod: 'short' }),
  );
  const maxPeriod = d3.greatest(workByPeriod, (d) => d[1])?.[0];

  dl.append('dt').text('Most work done');
  dl.append('dd').text(maxPeriod ?? '—');
}

function displayPath(file) {
  return file.replaceAll('\\', '/').replaceAll('/', '/\u200b');
}

let xScale;
let yScale;

// Hold blue overnight and orange through the workday so the mix
// does not fade through gray or pink.
const colorScale = d3
  .scaleLinear()
  .domain([0, 6, 8, 19, 20, 21, 24])
  .range(['#2f5fb8', '#2f5fb8', '#ef8c1a', '#ef8c1a', '#7a5098', '#2f5fb8', '#2f5fb8']);

const colors = d3.scaleOrdinal(d3.schemeTableau10);

function createXAxis() {
  return d3.axisBottom(xScale).ticks(4).tickFormat(d3.timeFormat('%b %d'));
}

function scatterLayout() {
  const width = 1000;
  const height = 600;
  const margin = { top: 16, right: 28, bottom: 64, left: 108 };
  const usableArea = {
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
    left: margin.left,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };

  return { width, height, margin, usableArea };
}

function renderScatterPlot(data, commits) {
  const { width, height, usableArea } = scatterLayout();

  const svg = d3
    .select('#chart')
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  xScale = d3
    .scaleTime()
    .domain(d3.extent(commits, (d) => d.datetime))
    .range([usableArea.left, usableArea.right])
    .nice();

  yScale = d3.scaleLinear().domain([0, 24]).range([usableArea.bottom, usableArea.top]);

  const gridlines = svg
    .append('g')
    .attr('class', 'gridlines')
    .attr('transform', `translate(${usableArea.left}, 0)`);

  const hourTicks = [0, 4, 8, 12, 16, 20];

  gridlines.call(
    d3.axisLeft(yScale).tickValues(hourTicks).tickFormat('').tickSize(-usableArea.width),
  );

  const xAxis = createXAxis();
  const yAxis = d3
    .axisLeft(yScale)
    .tickValues(hourTicks)
    .tickFormat((d) => String(d % 24).padStart(2, '0') + ':00');

  svg
    .append('g')
    .attr('transform', `translate(0, ${usableArea.bottom})`)
    .attr('class', 'x-axis')
    .call(xAxis);

  svg
    .append('g')
    .attr('transform', `translate(${usableArea.left}, 0)`)
    .attr('class', 'y-axis')
    .call(yAxis);

  svg.append('g').attr('class', 'dots');
  updateCommitDots(commits);
  createBrushSelector(svg);
}

function updateScatterPlot(data, commits) {
  const svg = d3.select('#chart').select('svg');
  if (svg.empty()) return;

  const timeExtent = commits.length
    ? d3.extent(commits, (d) => d.datetime)
    : timeScale.domain();

  xScale = xScale.domain(timeExtent).nice();

  const xAxisGroup = svg.select('g.x-axis');
  xAxisGroup.selectAll('*').remove();
  xAxisGroup.call(createXAxis());

  updateCommitDots(commits);
  refreshBrushSelection();
}

function updateCommitDots(commits) {
  const [minLines, maxLines] = d3.extent(commits, (d) => d.totalLines);
  const rDomain =
    minLines == null || minLines === maxLines ? [0, maxLines || 1] : [minLines, maxLines];
  const rScale = d3.scaleSqrt().domain(rDomain).range([2, 30]);
  const sortedCommits = d3.sort(commits, (d) => -d.totalLines);
  const dots = d3.select('#chart').select('g.dots');

  dots
    .selectAll('circle')
    .data(sortedCommits, (d) => d.id)
    .join('circle')
    .attr('cx', (d) => xScale(d.datetime))
    .attr('cy', (d) => yScale(d.hourFrac))
    .attr('r', (d) => rScale(d.totalLines))
    .attr('fill', (d) => colorScale(d.hourFrac))
    .style('fill-opacity', 0.7)
    .on('mouseenter', (event, commit) => {
      d3.select(event.currentTarget).style('fill-opacity', 1);
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).style('fill-opacity', 0.7);
      updateTooltipVisibility(false);
    })
    .order();
}

function createBrushSelector(svg) {
  svg.call(d3.brush().on('start brush end', brushed));
  svg.selectAll('.dots, .overlay ~ *').raise();
}

function brushed(event) {
  const selection = event.selection;
  d3.selectAll('#chart circle').classed('selected', (d) => isCommitSelected(selection, d));
  renderSelectionCount(selection);
  renderLanguageBreakdown(selection);
}

function refreshBrushSelection() {
  const svg = d3.select('#chart svg');
  if (svg.empty()) return;

  const selection = d3.brushSelection(svg.node());
  d3.selectAll('#chart circle').classed('selected', (d) => isCommitSelected(selection, d));
  renderSelectionCount(selection);
  renderLanguageBreakdown(selection);
}

function isCommitSelected(selection, commit) {
  if (!selection || !commit) return false;

  const [x0, x1] = selection.map((d) => d[0]);
  const [y0, y1] = selection.map((d) => d[1]);
  const x = xScale(commit.datetime);
  const y = yScale(commit.hourFrac);

  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function renderSelectionCount(selection) {
  const selectedCommits = selection
    ? filteredCommits.filter((d) => isCommitSelected(selection, d))
    : [];

  const countElement = document.querySelector('#selection-count');
  countElement.textContent = `${selectedCommits.length || 'No'} commits selected`;

  return selectedCommits;
}

function renderLanguageBreakdown(selection) {
  const selectedCommits = selection
    ? filteredCommits.filter((d) => isCommitSelected(selection, d))
    : [];
  const container = document.getElementById('language-breakdown');

  if (selectedCommits.length === 0) {
    container.innerHTML = '';
    return;
  }

  const lines = selectedCommits.flatMap((d) => d.lines);
  const breakdown = d3.rollup(
    lines,
    (v) => v.length,
    (d) => d.type,
  );

  container.innerHTML = '';

  for (const [language, count] of breakdown) {
    const proportion = count / lines.length;
    const formatted = d3.format('.1~%')(proportion);
    container.innerHTML += `
      <dt>${language}</dt>
      <dd>${count} lines (${formatted})</dd>
    `;
  }
}

function renderTooltipContent(commit) {
  const link = document.getElementById('commit-link');
  const date = document.getElementById('commit-date');
  const time = document.getElementById('commit-tooltip-time');
  const author = document.getElementById('commit-author');
  const lines = document.getElementById('commit-lines');

  if (Object.keys(commit).length === 0) return;

  link.href = commit.url;
  link.textContent = commit.id;
  date.textContent = commit.datetime?.toLocaleString('en', {
    dateStyle: 'full',
  });
  time.textContent = commit.datetime?.toLocaleString('en', {
    timeStyle: 'short',
  });
  author.textContent = commit.author;
  lines.textContent = commit.totalLines;
}

function updateTooltipVisibility(isVisible) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.hidden = !isVisible;
}

function updateTooltipPosition(event) {
  const tooltip = document.getElementById('commit-tooltip');
  const margin = 8;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX;
  let top = event.clientY;

  if (left + rect.width > window.innerWidth - margin) {
    left = event.clientX - rect.width;
  }
  if (top + rect.height > window.innerHeight - margin) {
    top = event.clientY - rect.height;
  }

  tooltip.style.left = `${Math.max(margin, left)}px`;
  tooltip.style.top = `${Math.max(margin, top)}px`;
}

function updateFileDisplay(filtered) {
  const lines = filtered.flatMap((d) => d.lines);
  const files = d3
    .groups(lines, (d) => d.file)
    .map(([name, fileLines]) => ({ name, lines: fileLines }))
    .sort((a, b) => b.lines.length - a.lines.length);

  const filesContainer = d3
    .select('#files')
    .selectChildren('div')
    .data(files, (d) => d.name)
    .join((enter) =>
      enter.append('div').call((div) => {
        div.append('dt').call((dt) => {
          dt.append('code');
          dt.append('small');
        });
        div.append('dd');
      }),
    )
    .order();

  filesContainer.select('dt > code').text((d) => displayPath(d.name));
  filesContainer.select('small').text((d) => `${d.lines.length} lines`);

  filesContainer
    .select('dd')
    .selectChildren('div')
    .data((d) => d.lines)
    .join('div')
    .attr('class', 'loc')
    .attr('style', (d) => `--color: ${colors(d.type)}`);

  const types = [...new Set(lines.map((d) => d.type))];
  d3.select('#file-legend')
    .selectAll('span')
    .data(types, (d) => d)
    .join('span')
    .attr('style', (type) => `--color: ${colors(type)}`)
    .text((type) => type);
}

function commitStory(commit, index) {
  const editedFiles = d3.rollups(
    commit.lines,
    (lines) => lines.length,
    (line) => line.file,
  ).length;
  const when = commit.datetime.toLocaleString('en', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const linkText =
    index > 0 ? 'another glorious commit' : 'my first commit, and it was glorious';
  const lineLabel = commit.totalLines === 1 ? 'line' : 'lines';
  const fileLabel = editedFiles === 1 ? 'file' : 'files';

  return `
    On ${when},
    I made <a href="${commit.url}" target="_blank">${linkText}</a>.
    I edited ${commit.totalLines} ${lineLabel} across ${editedFiles} ${fileLabel}.
    Then I looked over all I had made, and I saw that it was very good.
  `;
}

function fileStory(commit, index) {
  const editedFiles = d3.rollups(
    commit.lines,
    (lines) => lines.length,
    (line) => line.file,
  ).length;
  const when = commit.datetime.toLocaleString('en', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const lineLabel = commit.totalLines === 1 ? 'line' : 'lines';
  const fileLabel = editedFiles === 1 ? 'file' : 'files';
  const commitLabel = index === 0 ? 'commit is' : 'commits are';

  return `
    By ${when}, ${index + 1} ${commitLabel} on the record.
    Each dot is a line those commits last touched, colored by language.
    <a href="${commit.url}" target="_blank">This commit</a>
    changed ${commit.totalLines} ${lineLabel} across ${editedFiles} ${fileLabel}.
    The longest files pull ahead as the repo grows.
  `;
}

function renderStory(selector, storyForCommit) {
  d3.select(selector)
    .selectAll('.step')
    .data(commits)
    .join('div')
    .attr('class', 'step')
    .html((commit, index) => storyForCommit(commit, index));
}

function onTimeSliderChange() {
  const slider = document.getElementById('commit-progress');
  commitProgress = Number(slider.value);
  commitMaxTime = timeScale.invert(commitProgress);
  applyCommitCutoff();
}

function applyCommitCutoff() {
  const time = document.getElementById('commit-time');
  time.dateTime = commitMaxTime.toISOString();
  time.textContent = commitMaxTime.toLocaleString('en', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  filteredCommits = commits.filter((d) => d.datetime <= commitMaxTime);
  const lines = filteredCommits.flatMap((d) => d.lines);

  updateScatterPlot(data, filteredCommits);
  renderCommitInfo(lines, filteredCommits);
  updateFileDisplay(filteredCommits);
}

function onStepEnter(response) {
  document.querySelectorAll('.step').forEach((step) => {
    step.classList.toggle('is-active', step === response.element);
  });

  commitMaxTime = response.element.__data__.datetime;
  commitProgress = timeScale(commitMaxTime);
  document.getElementById('commit-progress').value = commitProgress;
  applyCommitCutoff();
}

let data = await loadData();
let commits = processCommits(data);

let commitProgress = 100;
let timeScale = d3
  .scaleTime()
  .domain([
    d3.min(commits, (d) => d.datetime),
    d3.max(commits, (d) => d.datetime),
  ])
  .range([0, 100]);
let commitMaxTime = timeScale.invert(commitProgress);
let filteredCommits = commits;

renderScatterPlot(data, commits);
renderStory('#scatter-story', commitStory);
renderStory('#files-story', fileStory);

const slider = document.getElementById('commit-progress');
slider.value = timeScale(commits[0].datetime);
slider.addEventListener('input', onTimeSliderChange);
onTimeSliderChange();

const scatterScroller = scrollama();
scatterScroller
  .setup({
    container: '#scrolly-1',
    step: '#scrolly-1 .step',
    offset: 0.55,
  })
  .onStepEnter(onStepEnter);

const fileScroller = scrollama();
fileScroller
  .setup({
    container: '#scrolly-2',
    step: '#scrolly-2 .step',
    offset: 0.55,
  })
  .onStepEnter(onStepEnter);

window.addEventListener('resize', () => {
  scatterScroller.resize();
  fileScroller.resize();
});
