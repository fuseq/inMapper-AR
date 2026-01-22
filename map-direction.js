/**
 * MapDirection - SVG haritadan birim seçimi ve yön hesaplama
 */

class MapDirection {
    constructor() {
        this.rooms = [];
        this.doors = [];
        this.paths = [];
        this.svgElement = null;
    }

    /**
     * SVG içeriğini yükle ve parse et
     */
    loadSVG(svgContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgContent, 'image/svg+xml');
        this.svgElement = doc.documentElement.cloneNode(true);
        
        // Parse et
        this.parseRooms();
        this.parseDoors();
        this.parsePaths();
        
        console.log(`Yüklendi: ${this.rooms.length} oda, ${this.doors.length} kapı, ${this.paths.length} path`);
    }

    /**
     * Rooms grubunu parse et
     */
    parseRooms() {
        this.rooms = [];
        const roomsGroup = this.findGroup('Rooms');
        if (!roomsGroup) return;

        const elements = roomsGroup.querySelectorAll('path, polygon, rect');
        elements.forEach(el => {
            const id = el.getAttribute('id');
            if (!id) return;

            let roomType = 'Unknown';
            let parent = el.parentElement;
            while (parent && parent !== roomsGroup) {
                const parentId = parent.getAttribute('id');
                const parentLabel = parent.getAttribute('inkscape:label');
                if (parentId && !parentId.startsWith('ID') && !parentId.startsWith('g')) {
                    roomType = parentId;
                    break;
                }
                if (parentLabel) {
                    roomType = parentLabel;
                    break;
                }
                parent = parent.parentElement;
            }

            const center = this.getElementCenter(el);
            if (center) {
                this.rooms.push({ id, type: roomType, center, element: el });
            }
        });
    }

    /**
     * Doors grubunu parse et
     */
    parseDoors() {
        this.doors = [];
        const doorsGroup = this.findGroup('Doors');
        if (!doorsGroup) return;

        // Line elementleri
        doorsGroup.querySelectorAll('line').forEach(line => {
            const id = line.getAttribute('id');
            if (!id) return;

            const x1 = parseFloat(line.getAttribute('x1')) || 0;
            const y1 = parseFloat(line.getAttribute('y1')) || 0;
            const x2 = parseFloat(line.getAttribute('x2')) || 0;
            const y2 = parseFloat(line.getAttribute('y2')) || 0;

            this.doors.push({
                id, x1, y1, x2, y2,
                center: [(x1 + x2) / 2, (y1 + y2) / 2]
            });
        });

        // Path elementleri
        doorsGroup.querySelectorAll('path').forEach(path => {
            const id = path.getAttribute('id');
            const d = path.getAttribute('d');
            if (!id || !d) return;

            const coords = this.parsePathD(d);
            if (coords && coords.length >= 2) {
                this.doors.push({
                    id,
                    x1: coords[0].x, y1: coords[0].y,
                    x2: coords[1].x, y2: coords[1].y,
                    center: [(coords[0].x + coords[1].x) / 2, (coords[0].y + coords[1].y) / 2]
                });
            }
        });
    }

    /**
     * Paths grubunu parse et
     */
    parsePaths() {
        this.paths = [];
        const pathsGroup = this.findGroup('Paths');
        if (!pathsGroup) return;

        pathsGroup.querySelectorAll('line').forEach(line => {
            const id = line.getAttribute('id');
            if (!id) return;

            const x1 = parseFloat(line.getAttribute('x1')) || 0;
            const y1 = parseFloat(line.getAttribute('y1')) || 0;
            const x2 = parseFloat(line.getAttribute('x2')) || 0;
            const y2 = parseFloat(line.getAttribute('y2')) || 0;

            this.paths.push({ id, x1, y1, x2, y2 });
        });
    }

    /**
     * Grup bul (id veya inkscape:label ile)
     */
    findGroup(name) {
        let group = this.svgElement.querySelector(`g#${name}`);
        if (group) return group;

        const allGroups = this.svgElement.querySelectorAll('g');
        for (const g of allGroups) {
            if (g.getAttribute('inkscape:label') === name) return g;
        }
        return null;
    }

    /**
     * Element merkezini hesapla
     */
    getElementCenter(el) {
        const tag = el.tagName.toLowerCase();

        if (tag === 'rect') {
            const x = parseFloat(el.getAttribute('x')) || 0;
            const y = parseFloat(el.getAttribute('y')) || 0;
            const w = parseFloat(el.getAttribute('width')) || 0;
            const h = parseFloat(el.getAttribute('height')) || 0;
            return [x + w / 2, y + h / 2];
        }

        if (tag === 'polygon') {
            const points = el.getAttribute('points');
            if (!points) return null;
            const coords = points.trim().split(/[\s,]+/).map(parseFloat);
            let sx = 0, sy = 0, count = 0;
            for (let i = 0; i < coords.length; i += 2) {
                if (!isNaN(coords[i]) && !isNaN(coords[i + 1])) {
                    sx += coords[i];
                    sy += coords[i + 1];
                    count++;
                }
            }
            return count > 0 ? [sx / count, sy / count] : null;
        }

        if (tag === 'path') {
            const d = el.getAttribute('d');
            if (!d) return null;
            const coords = this.parsePathD(d);
            if (!coords || coords.length === 0) return null;
            let sx = 0, sy = 0;
            coords.forEach(c => { sx += c.x; sy += c.y; });
            return [sx / coords.length, sy / coords.length];
        }

        return null;
    }

    /**
     * SVG path d attribute parse
     */
    parsePathD(d) {
        const coords = [];
        const regex = /([MLHVZ])\s*([^MLHVZ]*)/gi;
        let match, cx = 0, cy = 0;

        while ((match = regex.exec(d)) !== null) {
            const cmd = match[1].toUpperCase();
            const params = match[2].trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));

            switch (cmd) {
                case 'M':
                case 'L':
                    for (let i = 0; i < params.length; i += 2) {
                        cx = params[i];
                        cy = params[i + 1];
                        coords.push({ x: cx, y: cy });
                    }
                    break;
                case 'H':
                    params.forEach(x => { cx = x; coords.push({ x: cx, y: cy }); });
                    break;
                case 'V':
                    params.forEach(y => { cy = y; coords.push({ x: cx, y: cy }); });
                    break;
            }
        }
        return coords;
    }

    /**
     * Odaları döndür
     */
    getRooms() {
        return this.rooms;
    }

    /**
     * Oda için kapı bul
     */
    findDoorForRoom(roomId) {
        // Önce direkt eşleşme
        let door = this.doors.find(d => d.id.startsWith(roomId + '_'));
        
        if (!door) {
            // En yakın kapıyı bul
            const room = this.rooms.find(r => r.id === roomId);
            if (!room) return null;

            let minDist = Infinity;
            this.doors.forEach(d => {
                const dist = this.distance(room.center, d.center);
                if (dist < minDist) {
                    minDist = dist;
                    door = d;
                }
            });
        }

        return door;
    }

    /**
     * İki oda arasında yön hesapla (path bazlı)
     */
    calculateDirection(startRoomId, endRoomId) {
        const startRoom = this.rooms.find(r => r.id === startRoomId);
        const endRoom = this.rooms.find(r => r.id === endRoomId);

        if (!startRoom || !endRoom) {
            console.error('Oda bulunamadı');
            return null;
        }

        // Kapıları bul
        const startDoor = this.findDoorForRoom(startRoomId);
        const endDoor = this.findDoorForRoom(endRoomId);

        // Başlangıç ve hedef noktaları (kapı varsa kapı, yoksa oda merkezi)
        const startPoint = startDoor ? startDoor.center : startRoom.center;
        const endPoint = endDoor ? endDoor.center : endRoom.center;

        console.log('Başlangıç kapı/oda koordinatı:', startPoint);
        console.log('Hedef kapı/oda koordinatı:', endPoint);

        // Path'ler üzerinden rota bul
        const pathResult = this.findPathBetweenPoints(startPoint, endPoint);
        
        if (pathResult && pathResult.length >= 2) {
            // ÖNEMLİ: Kapının koordinatını path'in başına ekle
            // Böylece ilk segment kapıdan path'e doğru olan yönü gösterir
            const pathWithDoor = [startPoint, ...pathResult];
            
            console.log('Kapı + Path ilk 5 nokta:', pathWithDoor.slice(0, 5).map(p => `(${p[0].toFixed(1)}, ${p[1].toFixed(1)})`));
            
            // İlk 5 segment üzerinden yön hesapla
            return this.calculateDirectionFromPath(pathWithDoor, 5);
        }

        // Fallback: Direkt yön
        return this.calculateDirectDirection(startPoint, endPoint);
    }

    /**
     * Direkt iki nokta arasında yön hesapla
     */
    calculateDirectDirection(startPoint, endPoint) {
        const dx = endPoint[0] - startPoint[0];
        const dy = endPoint[1] - startPoint[1];
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length === 0) return null;

        const normDx = dx / length;
        const normDy = dy / length;

        const angleRad = Math.atan2(normDy, normDx);
        const angleDeg = angleRad * (180 / Math.PI);
        const compassAngle = ((90 - angleDeg) % 360 + 360) % 360;
        const compass = this.getCompassDirection(compassAngle);
        const confidence = Math.min(1.0, length / 500);

        return {
            startPoint,
            endPoint,
            directionVector: [normDx, normDy],
            angleDegrees: angleDeg,
            compassAngle,
            compass,
            confidence,
            distance: length
        };
    }

    /**
     * Path noktalarından yön hesapla (ağırlıklı ortalama)
     */
    calculateDirectionFromPath(pathPoints, maxSegments = 5) {
        if (pathPoints.length < 2) return null;

        let weightedDx = 0;
        let weightedDy = 0;
        let totalWeight = 0;
        let segmentsUsed = 0;

        for (let i = 0; i < Math.min(maxSegments, pathPoints.length - 1); i++) {
            const p1 = pathPoints[i];
            const p2 = pathPoints[i + 1];

            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const length = Math.sqrt(dx * dx + dy * dy);

            if (length < 1) continue; // Çok kısa segmentleri atla

            // Tüm segmentler eşit ağırlıkta (sadece uzunluğa göre)
            const weight = length;

            weightedDx += (dx / length) * weight;
            weightedDy += (dy / length) * weight;
            totalWeight += weight;
            segmentsUsed++;
        }

        if (totalWeight === 0) return null;

        // Normalize
        let avgDx = weightedDx / totalWeight;
        let avgDy = weightedDy / totalWeight;
        const magnitude = Math.sqrt(avgDx * avgDx + avgDy * avgDy);

        if (magnitude > 0) {
            avgDx /= magnitude;
            avgDy /= magnitude;
        }

        const angleRad = Math.atan2(avgDy, avgDx);
        const angleDeg = angleRad * (180 / Math.PI);
        const compassAngle = ((90 - angleDeg) % 360 + 360) % 360;
        const compass = this.getCompassDirection(compassAngle);
        const confidence = Math.min(1.0, magnitude * segmentsUsed / maxSegments);

        return {
            startPoint: pathPoints[0],
            endPoint: pathPoints[pathPoints.length - 1],
            directionVector: [avgDx, avgDy],
            angleDegrees: angleDeg,
            compassAngle,
            compass,
            confidence,
            segmentsUsed
        };
    }

    /**
     * İki nokta arasında path bul (Dijkstra)
     */
    findPathBetweenPoints(startPoint, endPoint) {
        if (this.paths.length === 0) return null;

        // Graph oluştur
        const graph = new Map();
        const idToCoord = new Map(); // Node ID -> koordinat
        const coordToId = new Map(); // koordinat string -> Node ID
        let nodeId = 0;

        const getNodeId = (x, y) => {
            const key = `${x.toFixed(2)},${y.toFixed(2)}`;
            if (!coordToId.has(key)) {
                const id = nodeId++;
                coordToId.set(key, id);
                idToCoord.set(id, [x, y]);
                graph.set(id, []);
            }
            return coordToId.get(key);
        };

        // Path'leri graph'a ekle
        this.paths.forEach(path => {
            const id1 = getNodeId(path.x1, path.y1);
            const id2 = getNodeId(path.x2, path.y2);
            const dist = Math.sqrt(Math.pow(path.x2 - path.x1, 2) + Math.pow(path.y2 - path.y1, 2));

            graph.get(id1).push({ node: id2, dist });
            graph.get(id2).push({ node: id1, dist });
        });

        // En yakın başlangıç ve hedef node'ları bul
        let startNodeId = null, endNodeId = null;
        let minStartDist = Infinity, minEndDist = Infinity;

        for (const [id, coord] of idToCoord) {
            const startDist = this.distance(startPoint, coord);
            if (startDist < minStartDist) {
                minStartDist = startDist;
                startNodeId = id;
            }

            const endDist = this.distance(endPoint, coord);
            if (endDist < minEndDist) {
                minEndDist = endDist;
                endNodeId = id;
            }
        }

        if (startNodeId === null || endNodeId === null) return null;

        // Dijkstra
        const distances = new Map();
        const previous = new Map();
        const unvisited = new Set();

        for (const [id] of graph) {
            distances.set(id, Infinity);
            unvisited.add(id);
        }
        distances.set(startNodeId, 0);

        while (unvisited.size > 0) {
            let current = null;
            let minDist = Infinity;

            for (const id of unvisited) {
                if (distances.get(id) < minDist) {
                    minDist = distances.get(id);
                    current = id;
                }
            }

            if (current === null || current === endNodeId) break;
            unvisited.delete(current);

            for (const neighbor of graph.get(current)) {
                const alt = distances.get(current) + neighbor.dist;
                if (alt < distances.get(neighbor.node)) {
                    distances.set(neighbor.node, alt);
                    previous.set(neighbor.node, current); // Sadece önceki node ID'sini sakla
                }
            }
        }

        // Path'i reconstruct et (başlangıçtan hedefe doğru)
        const pathNodeIds = [];
        let current = endNodeId;

        // Hedeften başlangıca doğru node'ları topla
        while (current !== undefined && current !== null) {
            pathNodeIds.unshift(current);
            current = previous.get(current);
        }

        // Node ID'lerini koordinatlara çevir
        const pathCoords = pathNodeIds.map(id => idToCoord.get(id));

        console.log('Path bulundu:', pathCoords.length, 'nokta');
        if (pathCoords.length > 0) {
            console.log('İlk 5 nokta (başlangıçtan hedefe):', pathCoords.slice(0, 5).map(p => `(${p[0].toFixed(1)}, ${p[1].toFixed(1)})`));
            console.log('Son 3 nokta:', pathCoords.slice(-3).map(p => `(${p[0].toFixed(1)}, ${p[1].toFixed(1)})`));
        }

        return pathCoords.length > 1 ? pathCoords : null;
    }

    /**
     * Pusula yönü
     */
    getCompassDirection(angle) {
        angle = ((angle % 360) + 360) % 360;
        
        if (angle < 22.5 || angle >= 337.5) return 'Kuzey';
        if (angle < 67.5) return 'Kuzeydoğu';
        if (angle < 112.5) return 'Doğu';
        if (angle < 157.5) return 'Güneydoğu';
        if (angle < 202.5) return 'Güney';
        if (angle < 247.5) return 'Güneybatı';
        if (angle < 292.5) return 'Batı';
        return 'Kuzeybatı';
    }

    /**
     * İki nokta arası mesafe
     */
    distance(p1, p2) {
        return Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));
    }

    /**
     * SVG üzerinde ok çiz
     */
    drawArrowOnSVG(direction) {
        if (!this.svgElement || !direction) return;

        // Eski oku sil
        const oldArrow = this.svgElement.querySelector('#direction-arrow-group');
        if (oldArrow) oldArrow.remove();

        const ns = 'http://www.w3.org/2000/svg';
        const group = document.createElementNS(ns, 'g');
        group.setAttribute('id', 'direction-arrow-group');

        const startX = direction.startPoint[0];
        const startY = direction.startPoint[1];
        const arrowLength = 80;
        const endX = startX + direction.directionVector[0] * arrowLength;
        const endY = startY + direction.directionVector[1] * arrowLength;

        // Ok çizgisi
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', startX);
        line.setAttribute('y1', startY);
        line.setAttribute('x2', endX);
        line.setAttribute('y2', endY);
        line.setAttribute('stroke', '#00ff00');
        line.setAttribute('stroke-width', '4');
        line.setAttribute('stroke-linecap', 'round');
        group.appendChild(line);

        // Ok ucu
        const angle = Math.atan2(direction.directionVector[1], direction.directionVector[0]);
        const headLen = 15;
        const headAngle = Math.PI / 6;

        const head = document.createElementNS(ns, 'polygon');
        const hx1 = endX - headLen * Math.cos(angle - headAngle);
        const hy1 = endY - headLen * Math.sin(angle - headAngle);
        const hx2 = endX - headLen * Math.cos(angle + headAngle);
        const hy2 = endY - headLen * Math.sin(angle + headAngle);
        head.setAttribute('points', `${endX},${endY} ${hx1},${hy1} ${hx2},${hy2}`);
        head.setAttribute('fill', '#00ff00');
        group.appendChild(head);

        // Başlangıç noktası
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', startX);
        circle.setAttribute('cy', startY);
        circle.setAttribute('r', '8');
        circle.setAttribute('fill', '#00ff00');
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '2');
        group.appendChild(circle);

        this.svgElement.appendChild(group);
    }
}

