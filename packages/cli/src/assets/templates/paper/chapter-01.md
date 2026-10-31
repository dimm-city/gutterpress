@section .title

# {{TITLE}}

**First Author**^1^ and **Second Author**^2^

^1^ Department, Institution\
^2^ Department, Institution

@end-section

@section .abstract

**Abstract.** State the question, what you did, and what you found, in one
paragraph a reader can judge the paper by.

**Keywords:** first · second · third

@end-section

## 1 Introduction

Say what the problem is and why it matters, then what this paper
contributes. Cite earlier work with a number in brackets, like [[1]], and
list it under References below.

## 2 Method

Write mathematics as you would in LaTeX: $x \in \mathbb{R}^d$ in a line, or
on lines of its own, numbered with `\tag`:

$$
\hat{\theta} = \operatorname*{arg\,min}_{\theta} \; \frac{1}{n} \sum_{i=1}^{n} \ell\big(f_\theta(x_i), y_i\big)
\tag{1}
$$

Refer back to it as (1). A footnote goes like this.[^note]

[^note]: Notes are collected at the end of the file, before the references.

## 3 Results

@section .figure

**Table 1.** A caption above the table, kept on the same page as it. {.caption}

| Method | Error | Cost |
|:--|--:|--:|
| Baseline | $1.4 \times 10^{-7}$ | 1025 |
| This paper | $3.4 \times 10^{-12}$ | 33 |

@end-section

A figure works the same way: put the image and its caption inside
`@section .figure`, with `{.caption}` on the caption paragraph.

## 4 Conclusion

What was shown, and what it means.

@section .references

## References

1. A. Author, *Title of the paper*, Journal, 1 (2026), pp. 1--10. {#ref-1}

@end-section

[1]: #ref-1
