@section .title

# When Does Romberg Integration Help? A Ratio Test for the Error Expansion of the Trapezoidal Rule

**Ada Quill**^1,\*^ and **Rowan Tate**^2^

^1^ Department of Mathematics, Example University\
^2^ Institute for Numerical Computing, Example Institute of Technology\
^\*^ Corresponding author: ada.quill@example.org

October 2026

@end-section

@section .abstract

**Abstract.** Romberg integration accelerates the composite trapezoidal rule by repeated Richardson extrapolation, removing one even power of the step size at a time. It relies on the Euler--Maclaurin error expansion, which fails for periodic integrands, where the trapezoidal rule is already spectrally accurate, and for integrands with end-point singularities, where fractional powers appear. We show that a vanishing coefficient in the expansion is a third, silent failure: the next extrapolation step multiplies the error by a factor between $-4$ and $-3$, which we predict exactly. We then propose a ratio test that reads the leading exponent of each column of the Romberg tableau from three consecutive entries, and forms a further column only when the predicted ratio is observed. On four model integrands, the test matches the accuracy of classical Romberg integration on smooth problems at the cost of at most two further refinement levels, halves the cost when a coefficient vanishes, and cuts it nearly eightfold on a periodic integrand. Every result is reproducible with a 30-line program.

**Keywords:** Romberg integration · Richardson extrapolation · Euler--Maclaurin formula · trapezoidal rule · numerical quadrature

**MSC 2020:** 65D30, 65B05

@end-section

## 1 Introduction

Richardson's deferred approach to the limit [[1], [2]] turns a sequence of cheap, low-order approximations into a high-order one by eliminating the leading terms of their error expansion. Applied to the composite trapezoidal rule with successively halved step sizes, it yields Romberg integration [[3]], a method that has appeared in numerical analysis textbooks and surveys for more than half a century [[4], [5], [6]].

The method rests on one assumption: that the error of the trapezoidal rule has an asymptotic expansion in even powers of the step size, as the Euler--Maclaurin formula provides. That assumption fails in two well-known situations. For smooth periodic integrands every term of the expansion vanishes and the trapezoidal rule converges geometrically or faster [[7]], so extrapolation is unnecessary. For integrands with an algebraic end-point singularity the expansion acquires fractional powers [[8], [9]], so extrapolation is ineffective. Less widely appreciated is a third situation, in which extrapolation is counter-productive: when one coefficient of the expansion happens to vanish, eliminating the corresponding term amplifies the next one.

This paper makes three contributions:

1. A statement of the error of every column of the Romberg tableau that keeps track of the constants, and from it an exact prediction of the amplification caused by a vanishing coefficient (Sections 2 and 3).
2. A ratio test that reads the structure of the error expansion from the tableau itself, in the spirit of de Boor's cautious extrapolation [[10]], and decides column by column whether extrapolation is justified (Section 4).
3. A reproducible numerical study on four integrands that exhibit the four behaviors (Section 5).

## 2 The error expansion of the trapezoidal rule

Let $f$ be integrable on $[a,b]$, let $I = \int_a^b f(x)\,dx$, and for a positive integer $n$ let $h = (b-a)/n$ and $x_i = a + ih$. The composite trapezoidal rule is

$$
T(h) = h \left( \tfrac12 f(x_0) + f(x_1) + \cdots + f(x_{n-1}) + \tfrac12 f(x_n) \right).
\tag{1}
$$

Its error is described by the Euler--Maclaurin formula [[5], [11]].

**Theorem 1** (Euler--Maclaurin). *Let $f \in C^{2m+2}[a,b]$. Then there is a $\xi \in (a,b)$ such that*

$$
T(h) = I + \sum_{k=1}^{m} \tau_k h^{2k} + \frac{B_{2m+2}}{(2m+2)!}\,(b-a)\, f^{(2m+2)}(\xi)\, h^{2m+2},
\tag{2}
$$

*where the coefficients*

$$
\tau_k = \frac{B_{2k}}{(2k)!} \left[ f^{(2k-1)}(b) - f^{(2k-1)}(a) \right]
\tag{3}
$$

*do not depend on $h$, and $B_2 = \tfrac16$, $B_4 = -\tfrac1{30}$, $B_6 = \tfrac1{42}, \dots$ are the Bernoulli numbers.*

Two features of (2) matter for what follows: only even powers of $h$ appear, and each coefficient $\tau_k$ depends on $f$ only through its odd derivatives at the end points. Both features fail in important cases.

### 2.1 Periodic integrands

If $f$ is smooth and $(b-a)$-periodic, every $\tau_k$ vanishes, and (2) says only that the error is $O(h^{2m+2})$ for every $m$. The truth is better still. If $f$ has period $1$, is analytic in the strip $\lvert \operatorname{Im} z \rvert < \sigma$ and is bounded there by $M$, then[^tw]

$$
\bigl\lvert T(1/n) - I \bigr\rvert \le \frac{2M}{e^{2\pi\sigma n} - 1},
\tag{4}
$$

so the trapezoidal rule converges geometrically, and faster than any geometric rate when $f$ is entire. Nothing is left for extrapolation to remove.

[^tw]: Bound (4) is the estimate of Trefethen and Weideman [[7]], rescaled from period $2\pi$ to period $1$.

### 2.2 Algebraic end-point singularities

If $f$ is continuous on $[a,b]$ but a derivative is unbounded at an end point, Theorem 1 does not apply, and the expansion acquires non-integer powers of $h$ [[8], [9]]. For the model integrand $f(x) = \sqrt{x}$ on $[0,1]$, Navot's extension of the Euler--Maclaurin formula [[8]] gives

$$
T(h) - I = \zeta\bigl(-\tfrac12\bigr)\, h^{3/2} + \frac{h^2}{24} + O(h^4), \qquad \zeta\bigl(-\tfrac12\bigr) \approx -0.2079,
\tag{5}
$$

where $\zeta$ is the Riemann zeta function and the term $h^2/24$ comes from the regular end point $x = 1$. The leading term is a power of $h$ that no even-power extrapolation can remove. We confirmed (5) numerically: at $h = 2^{-12}$, the quantity $\bigl(T(h) - I - h^2/24\bigr)/h^{3/2}$ agrees with $\zeta(-\tfrac12)$ to ten significant digits.

## 3 Richardson extrapolation and the Romberg tableau

Halving the step size, $h_k = (b-a)/2^k$, reuses every previous function value,

$$
T(h_k) = \tfrac12\, T(h_{k-1}) + h_k \sum_{i=1}^{2^{k-1}} f\bigl(a + (2i-1)h_k\bigr),
\tag{6}
$$

so $T(h_0), \dots, T(h_k)$ together cost $2^k + 1$ evaluations of $f$. Romberg's method [[3]] sets $R_{k,0} = T(h_k)$ and eliminates one term of (2) per column:

$$
R_{k,j} = R_{k,j-1} + \frac{R_{k,j-1} - R_{k-1,j-1}}{4^j - 1}, \qquad 1 \le j \le k.
\tag{7}
$$

Column 1, $R_{k,1}$, is the composite Simpson rule with step $h_k$. The following proposition describes every column. We state it in a form that keeps track of the constants, because they explain the behavior observed in Section 5.

**Proposition 1.** *Let $f \in C^{2M+2}[a,b]$ and $0 \le j < M$. Then*

$$
R_{k,j} - I = \sum_{m=j+1}^{M} \gamma_{j,m}\, \tau_m\, h_k^{2m} + O\bigl(h_k^{2M+2}\bigr),
\tag{8}
$$

*with $\tau_m$ given by (3) and*

$$
\gamma_{j,m} = \prod_{i=1}^{j} \frac{4^i - 4^m}{4^i - 1}.
\tag{9}
$$

*Proof.* For $j = 0$, (8) is (2) with $\gamma_{0,m} = 1$. Suppose that (8) holds for $j - 1$. Since $h_{k-1} = 2h_k$, the term $\gamma_{j-1,m}\tau_m h_k^{2m}$ of $R_{k,j-1} - I$ appears as $4^m \gamma_{j-1,m}\tau_m h_k^{2m}$ in $R_{k-1,j-1} - I$, and (7) combines the two into $\gamma_{j-1,m}\,\frac{4^j - 4^m}{4^j - 1}\, \tau_m h_k^{2m}$. The factor vanishes for $m = j$, which removes the leading term, and the remainder stays $O(h_k^{2M+2})$. $\square$

When $\tau_{j+1} \ne 0$, column $j$ therefore converges with order $2j + 2$, as Romberg's method intends. When $\tau_{j+1} = 0$, the next column is no improvement.

**Corollary 1.** *Let $f$ satisfy the assumptions of Proposition 1 with $M \ge j + 2$, and let $\tau_{j+1} = 0 \ne \tau_{j+2}$. Then, as $k \to \infty$,*

$$
\frac{R_{k,j+1} - I}{R_{k,j} - I} \;\longrightarrow\; \frac{\gamma_{j+1,j+2}}{\gamma_{j,j+2}} = -\frac{3 \cdot 4^{j+1}}{4^{j+1} - 1}.
\tag{10}
$$

The limit is $-4$ for $j = 0$, $-3.2$ for $j = 1$, and tends to $-3$ as $j$ grows. Extrapolating a term that is absent thus multiplies the error by three to four, reverses its sign, and leaves its order unchanged.

## 4 Reading the expansion from the tableau

Proposition 1 rests on assumptions, smoothness and non-vanishing coefficients, that the user of a quadrature routine cannot easily check. The tableau itself carries the information. If the entries of column $j$ satisfy $R_{k,j} - I \approx C h_k^{p}$, the ratio of successive differences,

$$
\rho_k^{(j)} = \frac{R_{k-1,j} - R_{k-2,j}}{R_{k,j} - R_{k-1,j}},
\tag{11}
$$

satisfies

$$
\rho_k^{(j)} \to 2^{p} \qquad (k \to \infty).
\tag{12}
$$

Under the assumptions of Proposition 1 with $\tau_{j+1} \ne 0$, we have $p = 2j + 2$ and $\rho_k^{(j)} \to 4^{j+1}$. A measured ratio therefore distinguishes three situations:

- $\rho_k^{(j)} \approx 4^{j+1}$. The expansion behaves as assumed, and forming column $j + 1$ removes its leading term.
- $\rho_k^{(j)} \gg 4^{j+1}$. Column $j$ converges faster than assumed, because a coefficient vanishes or because $f$ is periodic, and by Corollary 1 a further column would amplify the error.
- $\rho_k^{(j)} < 4^{j+1}$. A lower power of $h$ dominates, as in (5), and even-power extrapolation cannot remove it.

Only the first situation justifies extrapolation. This is the idea behind de Boor's cautious extrapolation [[10]], which we use in its simplest form: column $j$ of row $k$ is formed only if

$$
\left\lvert \frac{\rho_k^{(j-1)}}{4^j} - 1 \right\rvert \le \delta,
\tag{13}
$$

and otherwise row $k$ ends at column $j - 1$. Algorithm 1 states the method in full.

**Algorithm 1** (Cautious Romberg integration). *Input:* $f$, $[a,b]$, a tolerance $\varepsilon$ and a threshold $\delta$.

1. Set $R_{0,0} = \tfrac12 (b-a)\bigl(f(a) + f(b)\bigr)$.
2. For $k = 1, 2, \dots$: compute $R_{k,0}$ by (6). Then, for $j = 1, \dots, k$: if column $j - 1$ has entries in rows $k - 2$, $k - 1$ and $k$, and (13) holds, compute $R_{k,j}$ by (7); otherwise end the row.
3. Let $R_{k,J}$ be the last entry of row $k$, and $R_{k-1,J'}$ the entry of row $k - 1$ in column $J$, or its last entry if that row is shorter. If $\lvert R_{k,J} - R_{k-1,J'} \rvert \le \varepsilon$, return $R_{k,J}$.

With $\delta = \infty$ the test always passes, and Algorithm 1 is classical Romberg integration. Listing 1 is a complete implementation. We use $\delta = 0.1$ throughout.[^delta]

[^delta]: Every $\delta$ from $0.02$ to $0.2$ gives the same results on all four test integrands. From $\delta = 0.3$ on, the test begins to accept the ratio $\rho \approx 2^{3/2}$ of $f_3$, for which $\lvert \rho/4 - 1 \rvert \approx 0.29$.

@section .figure

**Listing 1.** Algorithm 1 in Python. Called with $\delta = \infty$, it is classical Romberg integration. {.caption}

```python
import math

def romberg(f, a, b, tol, delta=0.1, kmax=20):
    """Cautious Romberg integration (Algorithm 1).
    delta = math.inf switches the ratio test off: classical Romberg."""
    R = [[(b - a) * (f(a) + f(b)) / 2]]
    for k in range(1, kmax + 1):
        h = (b - a) / 2**k
        new = sum(f(a + (2*i - 1) * h) for i in range(1, 2**(k - 1) + 1))
        row = [R[k - 1][0] / 2 + h * new]
        for j in range(1, k + 1):
            if not ratio_ok(R, row, j, delta):
                break
            row.append(row[j - 1] + (row[j - 1] - R[k - 1][j - 1]) / (4**j - 1))
        R.append(row)
        J = len(row) - 1
        if abs(row[J] - R[k - 1][min(J, len(R[k - 1]) - 1)]) <= tol:
            return row[J], 2**k + 1
    raise RuntimeError("tolerance not met")

def ratio_ok(R, row, j, delta):
    """The ratio test (13): does column j-1 shrink by 4**j per halving?"""
    if delta == math.inf:
        return True
    k = len(R)
    if k < 2 or len(R[k - 1]) < j or len(R[k - 2]) < j:
        return False
    d_old = R[k - 1][j - 1] - R[k - 2][j - 1]
    d_new = row[j - 1] - R[k - 1][j - 1]
    return d_new != 0 and abs(d_old / d_new / 4**j - 1) <= delta
```

@end-section

## 5 Numerical experiments

We applied the trapezoidal rule, classical Romberg integration and Algorithm 1 to the four integrands of Table 1, chosen to exhibit the four behaviors discussed above. All computations use IEEE double precision; the reference values were computed in 40-digit arithmetic.[^mp]

[^mp]: With the mpmath library for Python. In Table 1, $I_0$ is the modified Bessel function of the first kind.

@section .figure

**Table 1.** Test integrands on $[0,1]$ and the structure of their error expansions. {.caption}

|  | $f(x)$ | $I = \int_0^1 f(x)\,dx$ | Expansion (2) |
|:--|:--|:--|:--|
| $f_1$ | $e^x$ | $e - 1 = 1.718281828\ldots$ | all $\tau_k \ne 0$ |
| $f_2$ | $1/(1+x^2)$ | $\pi/4 = 0.785398163\ldots$ | $\tau_k = 0$ for even $k$ |
| $f_3$ | $\sqrt{x}$ | $2/3$ | does not apply; see (5) |
| $f_4$ | $e^{\cos 2\pi x}$ | $I_0(1) = 1.266065877\ldots$ | all $\tau_k = 0$; see (4) |

@end-section

Figure 1 shows the error of the trapezoidal rule and of the Romberg diagonal $R_{k,k}$ against the number of function evaluations. On $f_1$ and $f_2$ the diagonal reaches the rounding level with 33 and 129 evaluations, where the trapezoidal rule alone would need more than $10^7$. On $f_3$ the two curves are parallel: extrapolation gains a factor of about 3 but not a single order. On $f_4$ the order of merit is reversed: the trapezoidal rule reaches the rounding level with 17 evaluations, and the diagonal needs 513.

@section .figure

![Two log-log panels of absolute error against function evaluations for the four test integrands. Left, the trapezoidal rule: f1, f2 and f3 decrease along straight lines, f3 the most slowly, while f4 drops to the rounding level after 17 evaluations. Right, the Romberg diagonal: f1 and f2 fall steeply to the rounding level, f4 needs far more evaluations than in the left panel, and f3 remains a slow straight line.](figures/convergence.svg){.gp-full}

**Figure 1.** Absolute error against the number of function evaluations $2^k + 1$, for the trapezoidal rule (a) and the Romberg diagonal $R_{k,k}$ (b). Extrapolation accelerates $f_1$ and $f_2$, cannot accelerate $f_3$, and slows $f_4$ down. Errors below $10^{-16}$ are drawn at $10^{-16}$. {.caption}

@end-section

Table 2 confirms the orders predicted by (2), (5) and Proposition 1 to two decimal places. For $f_2$, where $\tau_2 = 0$ and $\tau_3 = \tfrac{1}{2016}$ by (3), Corollary 1 predicts more: the ratio $(R_{k,2} - I)/(R_{k,1} - I)$ should tend to $-3.2$. The measured ratios are $-3.1936$ at $k = 4$ and $-3.1995$ at $k = 5$, and the predicted error $\gamma_{1,3}\,\tau_3\, h_5^6 = -9.239 \times 10^{-12}$ of $R_{5,1}$ agrees with the measured error to all four digits shown.

@section .figure

**Table 2.** Observed orders of convergence $\log_2 (E_{4,j}/E_{5,j})$, where $E_{k,j} = \lvert R_{k,j} - I \rvert$, from 16 to 32 subintervals, with the orders predicted by (2), (5) and Proposition 1. $f_4$ is omitted because its errors in columns 0 and 1 are already at the rounding level. {.caption}

|  | $j = 0$ | $j = 1$ | $j = 2$ | Predicted |
|:--|--:|--:|--:|:--|
| $f_1$ | 2.00 | 4.00 | 6.00 | 2, 4, 6 |
| $f_2$ | 2.00 | 6.00 | 6.00 | 2, 6, 6 |
| $f_3$ | 1.48 | 1.50 | 1.50 | 3/2, 3/2, 3/2 |

@end-section

The ratios (11) identify each case from the tableau alone. In column 0, $\rho_k^{(0)}$ reaches $4.000$ by $k = 4$ for $f_2$ and by $k = 6$ for $f_1$. For $f_3$ it is $2.80$ at $k = 8$, approaching $2^{3/2} \approx 2.83$. For $f_4$ it is $49.6$ at $k = 3$ and $2.7 \times 10^4$ at $k = 4$. In column 1, $\rho_k^{(1)}$ approaches $16$ for $f_1$ ($15.99$ at $k = 6$) but $64$ for $f_2$ ($63.99$), which reveals that $\tau_2 = 0$.

@section .figure

**Table 3.** Function evaluations needed to meet the tolerance $\varepsilon$, with the actual error in parentheses, for the trapezoidal rule (stopping when $\lvert T(h_k) - T(h_{k-1}) \rvert \le \varepsilon$), classical Romberg integration ($\delta = \infty$) and Algorithm 1 ($\delta = 0.1$). An error of $0$ means the result is the double-precision number nearest to $I$; a dash means the tolerance was not met with $2^{20} + 1$ evaluations. {.caption}

|  | $\varepsilon$ | Trapezoidal rule | Romberg | Algorithm 1 |
|:--|:--|--:|--:|--:|
| $f_1$ | $10^{-6}$ | $1025\ (1.4 \times 10^{-7})$ | $9\ (3.4 \times 10^{-10})$ | $33\ (3.4 \times 10^{-12})$ |
|  | $10^{-10}$ | $131073\ (8.3 \times 10^{-12})$ | $33\ (0)$ | $65\ (0)$ |
| $f_2$ | $10^{-6}$ | $513\ (1.6 \times 10^{-7})$ | $33\ (1.2 \times 10^{-11})$ | $17\ (5.9 \times 10^{-10})$ |
|  | $10^{-10}$ | $65537\ (9.7 \times 10^{-12})$ | $65\ (1.8 \times 10^{-14})$ | $65\ (1.4 \times 10^{-13})$ |
| $f_3$ | $10^{-6}$ | $8193\ (2.8 \times 10^{-7})$ | $4097\ (2.6 \times 10^{-7})$ | $8193\ (2.8 \times 10^{-7})$ |
|  | $10^{-10}$ | --- | --- | --- |
| $f_4$ | $10^{-6}$ | $17\ (2.2 \times 10^{-16})$ | $129\ (1.0 \times 10^{-11})$ | $17\ (2.2 \times 10^{-16})$ |
|  | $10^{-10}$ | $33\ (2.2 \times 10^{-16})$ | $257\ (2.2 \times 10^{-15})$ | $33\ (2.2 \times 10^{-16})$ |

@end-section

Table 3 compares the cost of meeting a tolerance. Every run that stopped met its tolerance, so the stopping test was conservative throughout. On $f_1$, Algorithm 1 needs one or two more refinement levels than classical Romberg integration, because it forms column $j$ only after three entries of column $j - 1$ have confirmed the ratio $4^j$. On $f_2$ it stops at column 1, where Corollary 1 places the smallest error, and needs half the evaluations of classical Romberg at $\varepsilon = 10^{-6}$. On $f_4$ it never extrapolates and is 7.6 to 7.8 times cheaper. On $f_3$ no method is efficient: Algorithm 1 correctly declines to extrapolate, and the remedy lies elsewhere (Section 6).

## 6 Discussion

*The cost of caution.* Requiring three entries before a column is trusted delays extrapolation by at most two refinement levels on smooth integrands. In exchange, Algorithm 1 cannot be misled by a vanishing coefficient or by periodicity, the two cases in which classical Romberg integration silently does worse than the method it is meant to accelerate.

*Singular integrands.* For $f_3$ the ratio test diagnoses the problem but does not solve it. Two remedies are standard. If the exponents of the expansion are known, here $\tfrac32, 2, 4, 6, \dots$ from (5), Richardson extrapolation with those exponents restores rapid convergence [[9], [12]], and (12) even estimates the leading exponent from the data. Alternatively, a change of variables removes the singularity: with $x = t^2$,

$$
\int_0^1 \sqrt{x}\,dx = \int_0^1 2t^2\,dt,
\tag{14}
$$

which Simpson's rule, and hence column 1 of the tableau, integrates exactly.

*Limitations.* The threshold $\delta$ is a heuristic, although the results are insensitive to it over an order of magnitude. Once the differences in (11) reach the rounding level the ratio carries no information; Listing 1 treats a zero difference as a failed test, which is the right decision, because a column that has stopped changing cannot be improved. Finally, four model integrands illustrate the mechanisms but do not measure performance on a realistic workload.

## 7 Conclusion

Romberg integration helps when, and only when, the error of the trapezoidal rule expands in even powers of the step size with non-vanishing coefficients. That condition can be read from the tableau itself: the ratio of successive differences in column $j$ should approach $4^{j+1}$. Forming a new column only when it does costs at most two refinement levels on smooth integrands, and guards against the two ways in which extrapolation fails silently: on periodic integrands, where it is wasteful, and on integrands with a vanishing coefficient, where it amplifies the error by a factor of three to four.

**Acknowledgments.** This article is the sample paper distributed with Gutterpress. It was written in Markdown with LaTeX mathematics and typeset by Gutterpress; its results are genuine.

**Data availability.** Listing 1 and the integrands of Table 1 are sufficient to reproduce every number in this article.

[1]: #ref-1
[2]: #ref-2
[3]: #ref-3
[4]: #ref-4
[5]: #ref-5
[6]: #ref-6
[7]: #ref-7
[8]: #ref-8
[9]: #ref-9
[10]: #ref-10
[11]: #ref-11
[12]: #ref-12
